// ============================================================
// Health & Metrics Routes
// ============================================================
// Operasyonel temel:
// - GET /health: DB + Redis ping, basit liveness
// - GET /metrics: rapor metric'leri (Prometheus formatı YOK — basit JSON)
//   FAZ 2'de prom-client eklenebilir.
// ============================================================

import type { FastifyInstance } from 'fastify';
import { getPrisma } from '../../infrastructure/db.js';
import { getRedisConnection } from '../../infrastructure/queue.js';
import { logger } from '../../infrastructure/logger.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const checks: Record<string, { ok: boolean; error?: string }> = {};

    // DB ping
    try {
      await getPrisma().$queryRaw`SELECT 1`;
      checks.database = { ok: true };
    } catch (err) {
      checks.database = { ok: false, error: (err as Error).message };
    }

    // Redis ping
    try {
      const pong = await getRedisConnection().ping();
      checks.redis = { ok: pong === 'PONG' };
    } catch (err) {
      checks.redis = { ok: false, error: (err as Error).message };
    }

    const allOk = Object.values(checks).every((c) => c.ok);
    reply.status(allOk ? 200 : 503).send({
      status: allOk ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/metrics', async (_req, reply) => {
    const prisma = getPrisma();
    try {
      const [
        totalComments,
        repliesSent,
        humanReviewPending,
        last24hComments,
      ] = await Promise.all([
        prisma.comment.count(),
        prisma.commentProcessing.count({ where: { replyStatus: 'sent' } }),
        prisma.humanReviewQueue.count({ where: { status: 'pending' } }),
        prisma.comment.count({
          where: { receivedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        }),
      ]);

      reply.send({
        totalComments,
        repliesSent,
        humanReviewPending,
        last24hComments,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'metrics query failed');
      reply.status(500).send({ error: 'metrics_unavailable' });
    }
  });
}
