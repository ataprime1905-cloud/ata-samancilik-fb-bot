// ============================================================
// Logger
// ============================================================
// PII-safe: token ve secret alanlar otomatik redact edilir.
// KVKK + Meta policy gereği ham token loglama YASAK.
// ============================================================

import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // PII / secret redaction
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-hub-signature-256"]',
      'access_token',
      'page_access_token',
      'META_PAGE_ACCESS_TOKEN',
      'META_APP_SECRET',
      'ADMIN_API_KEY',
      'LLM_API_KEY',
      'password',
      'secret',
      '*.password',
      '*.secret',
      '*.access_token',
      '*.accessToken',
      // Comment author ham id'lerini de redact et
      '*.author_platform_id',
      '*.authorPlatformId',
    ],
    censor: '[REDACTED]',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss' },
        },
      }
    : {}),
});

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
