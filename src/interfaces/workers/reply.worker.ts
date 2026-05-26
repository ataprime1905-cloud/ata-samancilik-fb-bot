// ============================================================
// Reply Sending Worker
// ============================================================
// BullMQ worker: REPLY_QUEUE -> Meta Graph API -> reply gönder
//
// Rate-limit handling:
// - Meta code 4/17/32/613 gelirse -> job'u delay ile tekrar kuy
// - Token invalid (190) -> worker durur, alarm yükselt
// - Transient error -> BullMQ retry (exponential backoff)
//
// Double-send koruması: DB'deki replyStatus="sent" ise atla.
// ============================================================

import { Worker, type Job } from 'bullmq';
import { loadEnv } from '../../config/env.js';
import { logger } from '../../infrastructure/logger.js';
import {
  REPLY_QUEUE_NAME,
  DEAD_LETTER_QUEUE_NAME,
  getDeadLetterQueue,
  type ReplyJobData,
} from '../../infrastructure/queue.js';
import {
  isAlreadyReplied,
  markReplyResult,
  recordReplyAttempt,
} from '../../application/services/comment-service.js';
import { getPrisma } from '../../infrastructure/db.js';
import { RealMetaGraphClient, MetaGraphError } from '../../infrastructure/meta/graph-client.js';

let replyWorker: Worker | null = null;

export function startReplyWorker(): Worker {
  if (replyWorker) return replyWorker;

  const graphClient = new RealMetaGraphClient();

  replyWorker = new Worker<ReplyJobData>(
    REPLY_QUEUE_NAME,
    async (job: Job<ReplyJobData>) => {
      const { platform, commentId, replyText, attemptNo } = job.data;
      const childLog = logger.child({ jobId: job.id, platform, commentId });

      // 1. Idempotency: comment'i DB'den bul
      const prisma = getPrisma();
      const commentRow = await prisma.comment.findFirst({
        where: { platform, commentId },
        select: { id: true },
      });
      if (!commentRow) {
        childLog.warn('comment not found in DB, skipping reply');
        return;
      }

      // 2. Double-send koruması
      const alreadyDone = await isAlreadyReplied(commentRow.id);
      if (alreadyDone) {
        childLog.info('comment already replied — skipping');
        return;
      }

      childLog.info({ attemptNo, textLength: replyText.length }, 'sending reply');

      // 3. Graph API çağrısı
      try {
        const result = await graphClient.replyToFacebookComment(commentId, replyText);

        await markReplyResult(commentRow.id, {
          status: 'sent',
          metaReplyId: result.id,
        });

        await recordReplyAttempt(commentRow.id, attemptNo, replyText, 'success', result);

        childLog.info({ metaReplyId: result.id }, 'reply sent successfully');
      } catch (err) {
        const graphErr = err instanceof MetaGraphError ? err : null;

        if (graphErr?.isRateLimit()) {
          // Rate limit: BullMQ retry mekanizması ile delay ekle
          childLog.warn(
            { code: graphErr.code, attempt: job.attemptsMade },
            'rate limited by Meta — will retry',
          );
          await recordReplyAttempt(
            commentRow.id,
            attemptNo,
            replyText,
            'rate_limited',
            null,
            String(graphErr.code),
          );
          // BullMQ'da retry için Error fırlat (backoff aktif kalır)
          throw new Error(`rate_limited: ${graphErr.message}`);
        }

        if (graphErr?.isTokenInvalid()) {
          childLog.error(
            { code: graphErr.code },
            'META TOKEN INVALID — worker cannot proceed without human intervention',
          );
          await recordReplyAttempt(
            commentRow.id,
            attemptNo,
            replyText,
            'token_invalid',
            null,
            String(graphErr.code),
          );
          await markReplyResult(commentRow.id, {
            status: 'failed',
            errorCode: 'token_invalid',
            errorMessage: graphErr.message,
          });
          // Dead-letter'a at, alarm kaldır — BullMQ'nun retry'ını DURDUR
          await moveToDeadLetter(job, 'token_invalid');
          return; // fırlatma; BullMQ tekrar denemez
        }

        if (graphErr?.isPermissionError()) {
          childLog.error({ code: graphErr.code }, 'permission error — check token scopes');
          await recordReplyAttempt(
            commentRow.id,
            attemptNo,
            replyText,
            'permanent_error',
            null,
            String(graphErr.code),
          );
          await markReplyResult(commentRow.id, {
            status: 'failed',
            errorCode: 'permission_error',
            errorMessage: graphErr.message,
          });
          await moveToDeadLetter(job, 'permission_error');
          return;
        }

        // Geçici hata: retry et
        await recordReplyAttempt(
          commentRow.id,
          attemptNo,
          replyText,
          'transient_error',
          null,
          String(graphErr?.code ?? 'unknown'),
        );
        throw err; // BullMQ retry trigger
      }
    },
    {
      connection: { host: loadEnv().REDIS_HOST, port: loadEnv().REDIS_PORT, ...(loadEnv().REDIS_PASSWORD ? { password: loadEnv().REDIS_PASSWORD } : {}) },
      concurrency: 3, // Daha düşük: rate limit riskini azalt
      limiter: {
        max: 15, // MAX_REPLIES_PER_MINUTE brifindeki değer
        duration: 60_000,
      },
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
    },
  );

  replyWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err: err.message, attempts: job?.attemptsMade },
      'reply job failed',
    );
  });

  replyWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'reply worker error');
  });

  logger.info('reply worker started');
  return replyWorker;
}

export async function stopReplyWorker(): Promise<void> {
  if (replyWorker) {
    await replyWorker.close();
    replyWorker = null;
    logger.info('reply worker stopped');
  }
}

async function moveToDeadLetter(job: Job<ReplyJobData>, reason: string): Promise<void> {
  try {
    const dlq = getDeadLetterQueue();
    await dlq.add('dead-reply', { ...job.data, reason, failedAt: new Date().toISOString() });
    logger.info({ jobId: job.id, reason }, 'job moved to dead-letter queue');
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'failed to move job to dead-letter');
  }
}
