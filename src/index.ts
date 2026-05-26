// ============================================================
// Entry Point — src/index.ts
// ============================================================
// Bu dosya iki modu destekler:
//
//   node dist/index.js            -> HTTP server + worker birlikte (dev/small deploy)
//   node dist/index.js --worker   -> Sadece worker (ayrı process; production ölçekleme)
//   node dist/index.js --server   -> Sadece HTTP server
//
// Graceful shutdown: SIGTERM / SIGINT geldiğinde önce worker'ları kapat,
// sonra DB bağlantısını kes; in-flight job'lar tamamlanır.
// ============================================================

import { loadEnv } from './config/env.js';
import { logger } from './infrastructure/logger.js';
import { buildServer } from './interfaces/http/server.js';
import { startCommentWorker, stopCommentWorker } from './interfaces/workers/comment.worker.js';
import { startReplyWorker, stopReplyWorker } from './interfaces/workers/reply.worker.js';
import { disconnectPrisma } from './infrastructure/db.js';
import { getRedisConnection } from './infrastructure/queue.js';

const args = process.argv.slice(2);
const runWorkerOnly = args.includes('--worker');
const runServerOnly = args.includes('--server');

async function main(): Promise<void> {
  const env = loadEnv();

  logger.info(
    {
      mode: runWorkerOnly ? 'worker_only' : runServerOnly ? 'server_only' : 'combined',
      automationMode: env.AUTOMATION_MODE,
      nodeEnv: env.NODE_ENV,
    },
    'starting ata-samancilik-comment-manager',
  );

  // Worker başlat
  if (!runServerOnly) {
    startCommentWorker();
    startReplyWorker();
    logger.info('workers started');
  }

  // HTTP server başlat
  if (!runWorkerOnly) {
    const app = await buildServer();
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, 'http server listening');
  }

  // -------- Graceful shutdown --------
  const gracefulShutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'graceful shutdown initiated');

    // 1. Worker'lar: in-flight job'lar tamamlanana kadar bekle (30s timeout)
    await Promise.allSettled([stopCommentWorker(), stopReplyWorker()]);
    logger.info('workers stopped');

    // 2. DB bağlantısı kes
    await disconnectPrisma();
    logger.info('db disconnected');

    // 3. Redis bağlantısı kes
    try {
      await getRedisConnection().quit();
    } catch (_) {
      // Zaten kapanmış olabilir
    }
    logger.info('redis disconnected');

    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException — crashing');
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.fatal({ reason }, 'unhandledRejection — crashing');
    process.exit(1);
  });
}

main().catch((err) => {
  // loadEnv veya server başlatmada kritik hata
  console.error('FATAL startup error:', err);
  process.exit(1);
});
