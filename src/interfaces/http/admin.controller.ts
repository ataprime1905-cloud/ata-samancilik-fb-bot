// ============================================================
// Admin Controller
// ============================================================
// Basit API-key auth ile korunan admin endpoint'leri.
// FAZ 2'de JWT / OAuth ile değiştirilebilir.
//
// Endpoint'ler:
//   GET    /admin/comments                  — yorum listesi (pagination)
//   GET    /admin/comments/:id              — tek yorum + processing + review
//   POST   /admin/comments/:id/generate     — yorum için cevap üret (preview)
//   POST   /admin/comments/:id/approve      — cevabı onayla + gönder
//   POST   /admin/comments/:id/human-review — human review'a aktar
//
//   GET    /admin/human-review              — pending kuyruk
//   POST   /admin/human-review/:id/resolve  — onayla/reddet/düzenle
//
//   GET    /admin/prices                    — tüm il fiyatları
//   PUT    /admin/prices/:id               — fiyat güncelle
//
//   GET    /admin/products                  — ürünler
//   PUT    /admin/settings/automation-mode  — mod değiştir
//   POST   /admin/meta/token-health         — token geçerlilik kontrolü
// ============================================================

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { loadEnv } from '../../config/env.js';
import { getPrisma } from '../../infrastructure/db.js';
import { logger } from '../../infrastructure/logger.js';
import { listAllPrices, updatePriceById } from '../../application/services/price-service.js';
import { getAutomationMode, setAutomationMode } from '../../application/services/settings-service.js';
import { resolvePriceByCity } from '../../application/services/price-service.js';
import { loadContext, saveContext } from '../../application/services/context-service.js';
import { processComment } from '../../application/pipeline/comment-processor.js';
import { getLlmProvider } from '../../application/llm/factory.js';
import { writeAudit, markReplyResult, enqueueHumanReview } from '../../application/services/comment-service.js';
import { RealMetaGraphClient } from '../../infrastructure/meta/graph-client.js';
import { getReplyQueue, buildJobId, type ReplyJobData } from '../../infrastructure/queue.js';
import { AUTOMATION_MODES, type AutomationMode } from '../../config/constants.js';
import type { RawComment } from '../../domain/types.js';

// -------- Auth hook --------
async function requireAdminKey(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const env = loadEnv();
  const key = req.headers['x-admin-key'] ?? req.headers['authorization']?.replace('Bearer ', '');
  if (!key || key !== env.ADMIN_API_KEY) {
    reply.status(401).send({ error: 'unauthorized' });
  }
}

// -------- Zod schemas --------
const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const updatePriceSchema = z.object({
  priceTryPerTon: z.number().int().positive().optional(),
  isActive: z.boolean().optional(),
  minTonnageOverride: z.number().int().positive().nullable().optional(),
});

const resolveReviewSchema = z.object({
  action: z.enum(['approve', 'reject', 'edit_and_send']),
  editedReply: z.string().max(500).optional(),
  resolvedBy: z.string().optional(),
});

const automationModeSchema = z.object({
  mode: z.enum([
    AUTOMATION_MODES.PREVIEW_ONLY,
    AUTOMATION_MODES.SEMI_AUTO,
    AUTOMATION_MODES.FULL_AUTO,
  ]),
});

// -------- Route registration --------
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // Auth hook (all /admin/* routes)
  app.addHook('preHandler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.routeOptions.url?.startsWith('/admin')) {
      await requireAdminKey(req, reply);
    }
  });

  const prisma = getPrisma();

  // ======================================================
  // COMMENTS
  // ======================================================

  app.get('/admin/comments', async (req, reply) => {
    const q = paginationSchema.parse(req.query);
    const skip = (q.page - 1) * q.limit;
    const [comments, total] = await Promise.all([
      prisma.comment.findMany({
        skip,
        take: q.limit,
        orderBy: { receivedAt: 'desc' },
        include: { processing: true, humanReview: true },
      }),
      prisma.comment.count(),
    ]);
    reply.send({ comments, total, page: q.page, limit: q.limit });
  });

  app.get<{ Params: { id: string } }>('/admin/comments/:id', async (req, reply) => {
    const comment = await prisma.comment.findUnique({
      where: { id: req.params.id },
      include: { processing: true, humanReview: true, replyAttempts: true },
    });
    if (!comment) return reply.status(404).send({ error: 'not_found' });
    reply.send(comment);
  });

  /**
   * Yorum için preview modunda cevap üret.
   * DB'ye kaydetmez, sadece döndürür.
   */
  app.post<{ Params: { id: string } }>('/admin/comments/:id/generate', async (req, reply) => {
    const comment = await prisma.comment.findUnique({
      where: { id: req.params.id },
      include: { processing: true },
    });
    if (!comment) return reply.status(404).send({ error: 'not_found' });

    const rawComment: RawComment = {
      platform: comment.platform as 'facebook' | 'instagram',
      commentId: comment.commentId,
      authorPlatformId: comment.authorPlatformIdHash, // already hashed; pass-through
      text: comment.commentText,
    };

    const result = await processComment(rawComment, comment.authorPlatformIdHash, {
      resolvePrice: (city) => resolvePriceByCity(city),
      loadContext: (platform, hash) => loadContext(platform, hash),
      saveContext: (platform, hash, ctx) => saveContext(platform, hash, ctx),
      llm: getLlmProvider(),
      automationMode: AUTOMATION_MODES.PREVIEW_ONLY,
      llmMinConfidence: loadEnv().LLM_MIN_CONFIDENCE,
    });

    reply.send({
      intent: result.decision.intent,
      confidence: result.decision.confidence,
      replyText: result.decision.replyText,
      needsHuman: result.decision.needsHuman,
      humanReason: result.decision.humanReason,
      trace: result.decision.trace,
      safetyReasons: result.safetyReasons,
    });
  });

  /**
   * Cevabı onayла и gönder.
   * Eğer replyText geçilirse editlenmiş cevap kullanılır.
   */
  app.post<{ Params: { id: string }; Body: { replyText?: string } }>(
    '/admin/comments/:id/approve',
    async (req, reply) => {
      const comment = await prisma.comment.findUnique({
        where: { id: req.params.id },
        include: { processing: true },
      });
      if (!comment) return reply.status(404).send({ error: 'not_found' });
      if (!comment.processing) return reply.status(400).send({ error: 'not_processed_yet' });

      const replyText = req.body?.replyText ?? comment.processing.replyText;
      if (!replyText) return reply.status(400).send({ error: 'no_reply_text' });

      // Reply queue'ya at
      const replyQueue = getReplyQueue();
      const jobData: ReplyJobData = {
        platform: comment.platform,
        commentId: comment.commentId,
        replyText,
        attemptNo: 1,
      };
      await replyQueue.add('send-reply', jobData, {
        jobId: `approve:${buildJobId(comment.platform, comment.commentId)}`,
      });

      await writeAudit('admin_approve_reply', 'comment', comment.id, 'admin', 'admin_api');
      reply.send({ ok: true, queued: true });
    },
  );

  /**
   * Yorumu human review'a aktar.
   */
  app.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/admin/comments/:id/human-review',
    async (req, reply) => {
      const comment = await prisma.comment.findUnique({
        where: { id: req.params.id },
        include: { processing: true },
      });
      if (!comment) return reply.status(404).send({ error: 'not_found' });

      await enqueueHumanReview(
        comment.id,
        req.body?.reason ?? 'manual_admin_transfer',
        comment.processing?.replyText ?? null,
      );
      await writeAudit('admin_to_human_review', 'comment', comment.id, 'admin', 'admin_api');
      reply.send({ ok: true });
    },
  );

  // ======================================================
  // HUMAN REVIEW QUEUE
  // ======================================================

  app.get('/admin/human-review', async (req, reply) => {
    const q = paginationSchema.parse(req.query);
    const skip = (q.page - 1) * q.limit;
    const [items, total] = await Promise.all([
      prisma.humanReviewQueue.findMany({
        where: { status: 'pending' },
        skip,
        take: q.limit,
        orderBy: { createdAt: 'asc' },
        include: { comment: { include: { processing: true } } },
      }),
      prisma.humanReviewQueue.count({ where: { status: 'pending' } }),
    ]);
    reply.send({ items, total, page: q.page, limit: q.limit });
  });

  app.post<{ Params: { id: string }; Body: z.infer<typeof resolveReviewSchema> }>(
    '/admin/human-review/:id/resolve',
    async (req, reply) => {
      const body = resolveReviewSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues });

      const reviewItem = await prisma.humanReviewQueue.findUnique({
        where: { id: req.params.id },
        include: { comment: true },
      });
      if (!reviewItem) return reply.status(404).send({ error: 'not_found' });

      const { action, editedReply, resolvedBy } = body.data;

      if (action === 'reject') {
        await prisma.humanReviewQueue.update({
          where: { id: req.params.id },
          data: { status: 'rejected', resolvedBy: resolvedBy ?? 'admin', resolvedAt: new Date() },
        });
        await markReplyResult(reviewItem.comment.id, { status: 'skipped' });
        reply.send({ ok: true, action: 'rejected' });
        return;
      }

      // approve or edit_and_send
      const finalReply =
        action === 'edit_and_send' ? editedReply ?? reviewItem.suggestedReply : reviewItem.suggestedReply;
      if (!finalReply) return reply.status(400).send({ error: 'no_reply_text' });

      // Graph API ile direkt gönder
      const env = loadEnv();
      const client = new RealMetaGraphClient();
      try {
        const result = await client.replyToFacebookComment(reviewItem.comment.commentId, finalReply);
        await markReplyResult(reviewItem.comment.id, { status: 'sent', metaReplyId: result.id });
        await prisma.humanReviewQueue.update({
          where: { id: req.params.id },
          data: {
            status: action === 'edit_and_send' ? 'edited_and_sent' : 'approved',
            resolvedBy: resolvedBy ?? 'admin',
            resolvedAt: new Date(),
          },
        });
        await writeAudit('human_review_resolved', 'comment', reviewItem.comment.id, resolvedBy ?? 'admin', 'admin_api');
        reply.send({ ok: true, metaReplyId: result.id });
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'admin approve reply failed');
        reply.status(502).send({ error: 'send_failed', message: (err as Error).message });
      }
    },
  );

  // ======================================================
  // PRICES
  // ======================================================

  app.get('/admin/prices', async (_req, reply) => {
    const prices = await listAllPrices();
    reply.send({ prices });
  });

  app.put<{ Params: { id: string }; Body: z.infer<typeof updatePriceSchema> }>(
    '/admin/prices/:id',
    async (req, reply) => {
      const body = updatePriceSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues });

      try {
        await updatePriceById(req.params.id, body.data);
        await writeAudit('price_updated', 'city_price', req.params.id, 'admin', 'admin_api');
        reply.send({ ok: true });
      } catch (err) {
        logger.error({ err: (err as Error).message }, 'price update failed');
        reply.status(500).send({ error: 'update_failed' });
      }
    },
  );

  // ======================================================
  // PRODUCTS
  // ======================================================

  app.get('/admin/products', async (_req, reply) => {
    const products = await prisma.product.findMany({
      include: { attributes: true, cityPrices: { take: 0 } }, // city fiyatları çok fazla
    });
    reply.send({ products });
  });

  // ======================================================
  // SETTINGS
  // ======================================================

  app.get('/admin/settings', async (_req, reply) => {
    const mode = await getAutomationMode();
    reply.send({ automationMode: mode });
  });

  app.put<{ Body: z.infer<typeof automationModeSchema> }>(
    '/admin/settings/automation-mode',
    async (req, reply) => {
      const body = automationModeSchema.safeParse(req.body);
      if (!body.success) return reply.status(400).send({ error: body.error.issues });

      await setAutomationMode(body.data.mode as AutomationMode);
      await writeAudit(
        'automation_mode_changed',
        'setting',
        'automation_mode',
        'admin',
        'admin_api',
      );
      logger.info({ mode: body.data.mode }, 'automation mode changed');
      reply.send({ ok: true, mode: body.data.mode });
    },
  );

  // ======================================================
  // META TOKEN HEALTH
  // ======================================================

  app.post('/admin/meta/token-health', async (_req, reply) => {
    const client = new RealMetaGraphClient();
    const [health, perms] = await Promise.all([
      client.healthCheckToken(),
      client.validatePermissions(),
    ]);
    reply.send({ tokenHealth: health, permissions: perms });
  });
}
