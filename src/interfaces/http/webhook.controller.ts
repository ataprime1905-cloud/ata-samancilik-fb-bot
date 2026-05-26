// ============================================================
// Meta Webhook Controller
// ============================================================
// GET /webhooks/meta — Verify challenge (subscribe akışı)
// POST /webhooks/meta — Yeni event geldiğinde:
//   1. X-Hub-Signature-256 doğrula (raw body)
//   2. Payload'ı parse et (page/instagram)
//   3. comment_id ile dedup; queue'ya at; 200 OK hızlıca dön
//
// Kural: işin GERÇEKLEŞTİĞİ YER WEBHOOK DEĞİL — worker.
// Webhook sadece tetikleyici. Bu sayede Meta'nın retry'larına
// idempotent davranabiliyoruz; rate-limit/yavaş işleme webhook'u boğmaz.
// ============================================================

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loadEnv } from '../../config/env.js';
import { verifyMetaSignature, verifyChallenge } from '../../infrastructure/meta/signature.js';
import { META_SIGNATURE_HEADER, PLATFORMS } from '../../config/constants.js';
import { getCommentQueue, buildJobId, type CommentJobData } from '../../infrastructure/queue.js';
import type { MetaWebhookPayload } from '../../domain/types.js';
import { logger } from '../../infrastructure/logger.js';
import { writeAudit } from '../../application/services/comment-service.js';
import { hashPayload } from '../../infrastructure/db.js';

interface ChallengeQuery {
  'hub.mode'?: string;
  'hub.verify_token'?: string;
  'hub.challenge'?: string;
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  // ----------- GET /webhooks/meta — subscribe challenge -----------
  app.get<{ Querystring: ChallengeQuery }>('/webhooks/meta', async (req, reply) => {
    const env = loadEnv();
    const result = verifyChallenge({
      mode: req.query['hub.mode'],
      token: req.query['hub.verify_token'],
      challenge: req.query['hub.challenge'],
      expectedToken: env.META_WEBHOOK_VERIFY_TOKEN,
    });
    if (result) {
      logger.info('webhook verify challenge succeeded');
      reply.type('text/plain').send(result);
      return;
    }
    logger.warn(
      { mode: req.query['hub.mode'] },
      'webhook verify challenge FAILED — token mismatch or missing params',
    );
    reply.status(403).send({ error: 'verification_failed' });
  });

  // ----------- POST /webhooks/meta — event push -----------
  app.post('/webhooks/meta', async (req, reply) => {
    const env = loadEnv();

    // 1. Signature verify (raw body üzerinden)
    const signatureHeader = req.headers[META_SIGNATURE_HEADER];
    const sigStr = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const rawBody = req.rawBody;

    if (!rawBody) {
      logger.warn('webhook POST without raw body — parser misconfigured');
      reply.status(400).send({ error: 'bad_request' });
      return;
    }

    if (!env.META_APP_SECRET) {
      // Üretim'de bu KRİTİK; geliştirme ortamında uyar ama kabul et
      if (env.NODE_ENV === 'production') {
        logger.error('META_APP_SECRET missing in production — refusing webhook');
        reply.status(500).send({ error: 'misconfigured' });
        return;
      }
      logger.warn('META_APP_SECRET missing (dev mode) — skipping signature verification');
    } else {
      const ok = verifyMetaSignature({
        rawBody,
        signatureHeader: sigStr,
        appSecret: env.META_APP_SECRET,
      });
      if (!ok) {
        logger.warn({ hasSig: Boolean(sigStr) }, 'webhook signature INVALID');
        reply.status(401).send({ error: 'invalid_signature' });
        return;
      }
    }

    // 2. Payload parse
    const payload = req.body as MetaWebhookPayload;
    if (!payload || !payload.object || !Array.isArray(payload.entry)) {
      reply.status(400).send({ error: 'invalid_payload' });
      return;
    }

    const platform =
      payload.object === 'instagram' ? PLATFORMS.INSTAGRAM : PLATFORMS.FACEBOOK;

    // 3. Her entry'deki comment-related changes için job enqueue
    let queued = 0;
    let skipped = 0;
    const queue = getCommentQueue();

    for (const entry of payload.entry) {
      const changes = entry.changes ?? [];
      for (const change of changes) {
        // Sadece "feed" field'ı ve "comment" item ile ilgili event'ler
        // (örnek event: { field: "feed", value: { item: "comment", verb: "add", ... } })
        if (change.field !== 'feed' && change.field !== 'comments') continue;
        const v = change.value;
        if (!v) continue;
        if (v.item && v.item !== 'comment') continue;
        if (v.verb && v.verb !== 'add') continue; // sadece yeni yorumlar

        const commentId = v.comment_id;
        if (!commentId) {
          skipped++;
          continue;
        }

        const jobData: CommentJobData = {
          platform,
          commentId,
          receivedAt: new Date().toISOString(),
          raw: change.value,
        };

        // jobId = idempotency: aynı comment_id ile aynı job iki kez eklenmez
        await queue.add('process-comment', jobData, {
          jobId: buildJobId(platform, commentId),
        });
        queued++;
      }
    }

    // Audit log — webhook geldi
    await writeAudit(
      'webhook_received',
      'webhook',
      null,
      'system',
      'webhook',
      hashPayload(payload),
    ).catch((err) => {
      logger.warn({ err: (err as Error).message }, 'audit log write failed');
    });

    logger.info({ queued, skipped, platform }, 'webhook processed');

    // 4. HIZLI 200 OK — gerçek iş queue'da
    reply.status(200).send({ ok: true, queued, skipped });
  });
}

// Test export
export type { FastifyRequest };
