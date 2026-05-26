// ============================================================
// Comment Processing Worker
// ============================================================
// BullMQ worker: COMMENT_QUEUE -> graph API fetch -> pipeline -> karar
//
// Akış:
// 1. Job al: { platform, commentId, receivedAt }
// 2. DB'de comment var mı? (idempotency: aynı job iki kez çalışırsa tekrar işleme)
// 3. Graph API'den yorum detayını çek (message, from, created_time)
// 4. authorId'yi hash'le; Comment + CommentProcessing upsert
// 5. processComment pipeline
// 6. action'a göre:
//    - send_now: reply queue'ya
//    - preview/queue_for_send: DB'ye kaydet, admin paneli görsün
//    - human_review: HumanReviewQueue'ya ekle
//    - ignore: loglа + geç
// 7. Audit log
//
// Rate limit / token hataları: BullMQ retry ile exponential backoff.
// ============================================================

import { Worker, type Job } from 'bullmq';
import { loadEnv } from '../../config/env.js';
import { logger } from '../../infrastructure/logger.js';
import {
  COMMENT_QUEUE_NAME,
  getReplyQueue,
  buildJobId,
  type CommentJobData,
  type ReplyJobData,
} from '../../infrastructure/queue.js';
import { hashAuthorId, hashPayload } from '../../infrastructure/db.js';
import {
  upsertComment,
  saveProcessing,
  enqueueHumanReview,
  writeAudit,
} from '../../application/services/comment-service.js';
import { resolvePriceByCity } from '../../application/services/price-service.js';
import { loadContext, saveContext } from '../../application/services/context-service.js';
import { getAutomationMode } from '../../application/services/settings-service.js';
import { getLlmProvider } from '../../application/llm/factory.js';
import { processComment } from '../../application/pipeline/comment-processor.js';
import { RealMetaGraphClient } from '../../infrastructure/meta/graph-client.js';
import { normalizeForMatching } from '../../application/normalizer/text-normalizer.js';
import type { RawComment } from '../../domain/types.js';
import { PLATFORMS } from '../../config/constants.js';

let worker: Worker | null = null;

export function startCommentWorker(): Worker {
  if (worker) return worker;

  const env = loadEnv();
  const graphClient = new RealMetaGraphClient();

  worker = new Worker<CommentJobData>(
    COMMENT_QUEUE_NAME,
    async (job: Job<CommentJobData>) => {
      const { platform, commentId, receivedAt, raw } = job.data;
      const childLog = logger.child({ jobId: job.id, platform, commentId });
      childLog.info('processing comment job');

      // 1. DB idempotency: zaten işlenmiş mi?
      const { id: commentDbId, isNew, authorHash } = await processIdempotency(
        platform,
        commentId,
        raw,
      );

      if (!isNew) {
        childLog.info('comment already in DB — checking if re-processing needed');
        // Eğer daha önce error ile bitmişse retry edebiliriz, aksi halde skip
        // Basit yaklaşım: isNew değilse atla (idempotent)
        return;
      }

      // 2. Graph API'den yorum detayını çek
      let commentText: string;
      let authorPlatformId: string;
      let authorName: string | undefined;

      try {
        const details = await graphClient.fetchCommentDetails(commentId);
        commentText = details.message;
        authorPlatformId = details.from?.id ?? commentId;
        authorName = details.from?.name;
        childLog.debug({ textLength: commentText.length }, 'comment details fetched');
      } catch (err) {
        childLog.error({ err: (err as Error).message }, 'graph API fetch failed');
        // Raw payload'da message varsa fallback
        const rawValue = raw as Record<string, unknown> | undefined;
        commentText = (rawValue?.message as string | undefined) ?? '';
        authorPlatformId = String((rawValue as Record<string, unknown> | undefined)?.['from'] && typeof rawValue?.['from'] === 'object' ? ((rawValue?.['from'] as Record<string, unknown>)?.['id'] ?? commentId) : commentId);
        if (!commentText) throw err; // retry
      }

      // 3. Comment DB güncelle (text + authorId ile)
      const authorFinalHash = hashAuthorId(authorPlatformId);
      await updateCommentText(commentDbId, commentText, authorFinalHash, authorName);

      // 4. Pipeline
      const rawComment: RawComment = {
        platform: platform as (typeof PLATFORMS)[keyof typeof PLATFORMS],
        commentId,
        authorPlatformId,
        authorName,
        text: commentText,
      };

      const automationMode = await getAutomationMode();

      const result = await processComment(rawComment, authorFinalHash, {
        resolvePrice: (city) => resolvePriceByCity(city),
        loadContext: (p, h) => loadContext(p, h),
        saveContext: (p, h, ctx) => saveContext(p, h, ctx),
        llm: getLlmProvider(),
        automationMode,
        llmMinConfidence: env.LLM_MIN_CONFIDENCE,
      });

      // 5. Processing kaydet
      const normalizedText = normalizeForMatching(commentText);
      await saveProcessing(commentDbId, result.decision, normalizedText, result.action);

      childLog.info(
        { intent: result.decision.intent, action: result.action },
        'pipeline result',
      );

      // 6. Action
      switch (result.action) {
        case 'send_now':
        case 'queue_for_send': {
          if (!result.decision.replyText) break;
          const replyQueue = getReplyQueue();
          const jobData: ReplyJobData = {
            platform,
            commentId,
            replyText: result.decision.replyText,
            attemptNo: 1,
          };
          await replyQueue.add('send-reply', jobData, {
            jobId: buildJobId(platform, commentId),
          });
          childLog.info('reply queued for sending');
          break;
        }

        case 'human_review': {
          await enqueueHumanReview(
            commentDbId,
            result.decision.humanReason ?? 'unknown',
            result.decision.replyText,
          );
          childLog.info({ reason: result.decision.humanReason }, 'sent to human review');
          break;
        }

        case 'preview': {
          // Admin panelde görülecek; otomatik gönderim yok
          childLog.info('preview mode — no auto send');
          break;
        }

        case 'ignore': {
          childLog.info('ignored (spam/off-topic/empty)');
          break;
        }
      }

      // 7. Audit
      await writeAudit(
        'comment_processed',
        'comment',
        commentDbId,
        'worker',
        'worker',
        hashPayload({ intent: result.decision.intent, action: result.action }),
      ).catch((err) => {
        childLog.warn({ err: (err as Error).message }, 'audit write failed');
      });
    },
    {
      connection: { host: loadEnv().REDIS_HOST, port: loadEnv().REDIS_PORT, ...(loadEnv().REDIS_PASSWORD ? { password: loadEnv().REDIS_PASSWORD } : {}) },
      concurrency: 5,
      removeOnComplete: { count: 1000, age: 24 * 3600 },
      removeOnFail: { count: 5000, age: 7 * 24 * 3600 },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, err: err.message, attempts: job?.attemptsMade },
      'comment job failed',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'comment worker error');
  });

  logger.info('comment worker started');
  return worker;
}

export async function stopCommentWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info('comment worker stopped');
  }
}

// -------- Helpers --------

async function processIdempotency(
  platform: string,
  commentId: string,
  raw: unknown,
): Promise<{ id: string; isNew: boolean; authorHash: string }> {
  // İlk upsert: sadece commentId ile; text Graph API'den gelecek
  const { id, isNew, authorHash } = await upsertComment({
    raw: {
      platform: platform as (typeof PLATFORMS)[keyof typeof PLATFORMS],
      commentId,
      authorPlatformId: commentId, // temporary; gerçek id Graph fetch'ten sonra
      text: '',
    },
    rawPayload: raw,
  });
  return { id, isNew, authorHash };
}

async function updateCommentText(
  commentDbId: string,
  text: string,
  authorHash: string,
  authorName?: string,
): Promise<void> {
  const { getPrisma } = await import('../../infrastructure/db.js');
  await getPrisma().comment.update({
    where: { id: commentDbId },
    data: {
      commentText: text,
      authorPlatformIdHash: authorHash,
      authorNameOptional: authorName ?? undefined,
    },
  });
}
