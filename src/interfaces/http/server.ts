// ============================================================
// Fastify Server
// ============================================================
// Kritik: Webhook signature verification için RAW BODY gerekir.
// Fastify default olarak JSON parse eder ve raw'u atar. Bu yüzden:
//   - addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)
//     ile raw buffer'ı saklıyoruz request.rawBody'de.
//   - Sonra normal JSON.parse yapıyoruz.
//
// Header isimleri Fastify tarafından lowercase'lenir; verify fonksiyonu
// 'x-hub-signature-256' lowercase header'a bakar.
// ============================================================

import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import { loadEnv } from '../../config/env.js';
import { logger } from '../../infrastructure/logger.js';
import { registerHealthRoutes } from './health.controller.js';
import { registerWebhookRoutes } from './webhook.controller.js';
import { registerAdminRoutes } from './admin.controller.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export async function buildServer(): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: false, // Pino'yu kendimiz kullanıyoruz; çift log'u önle
    bodyLimit: 1024 * 1024, // 1MB, webhook payload yeterli
    trustProxy: true,
  });

  // Helmet — basit security header'lar
  await app.register(helmet, {
    contentSecurityPolicy: false, // API, HTML servisi yok
  });

  // RAW BODY parser — Meta signature verification için
  // 'application/json' content-type'ında raw buffer'ı saklayıp normal JSON.parse yapıyoruz
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        req.rawBody = body as Buffer;
        const json = body.length > 0 ? JSON.parse((body as Buffer).toString('utf8')) : {};
        done(null, json);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Global error handler — internal hataları sızdırma
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    logger.error(
      {
        err: { name: error.name, message: error.message, stack: error.stack },
        url: request.url,
        method: request.method,
      },
      'unhandled error in request',
    );
    if (error.statusCode && error.statusCode < 500) {
      // Validation veya client error
      reply.status(error.statusCode).send({ error: error.message });
      return;
    }
    reply.status(500).send({ error: 'internal_server_error' });
  });

  // Request logging (info level)
  app.addHook('onResponse', (request, reply, done) => {
    logger.info(
      {
        method: request.method,
        url: request.url,
        status: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'http_request',
    );
    done();
  });

  // 404 handler
  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: 'not_found' });
  });

  // Route registration
  await registerHealthRoutes(app);
  await registerWebhookRoutes(app);
  await registerAdminRoutes(app);

  // PORT info log
  logger.info({ port: env.PORT, automationMode: env.AUTOMATION_MODE }, 'server configured');

  return app;
}
