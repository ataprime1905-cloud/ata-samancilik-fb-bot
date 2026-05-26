import { z } from 'zod';

// ============================================================
// Env validation
// ============================================================
// Notlar:
// - Tüm zorunlu değişkenler burada validate edilir.
// - Eksik/yanlış env'de fast-fail (üretimde yanlış config = felaket).
// - Token'lar burada parse edilir ama ASLA loglanmaz.
// ============================================================

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().min(8),
  META_PAGE_ACCESS_TOKEN: z.string().optional(),
  META_PAGE_ID: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().default('v21.0'),
  META_GRAPH_API_BASE_URL: z.string().url().default('https://graph.facebook.com'),

  LLM_PROVIDER: z.enum(['none', 'mock', 'openai', 'anthropic', 'google', 'cohere']).default('mock'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('gpt-5.4-nano'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  LLM_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),

  AUTOMATION_MODE: z.enum(['preview_only', 'semi_auto', 'full_auto']).default('preview_only'),

  CONVERSATION_STATE_TTL_HOURS: z.coerce.number().int().positive().default(24),
  MAX_REPLIES_PER_MINUTE: z.coerce.number().int().positive().default(15),
  RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  RETRY_INITIAL_BACKOFF_MS: z.coerce.number().int().positive().default(1000),

  ADMIN_API_KEY: z.string().min(8),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Hata mesajı: hangi alan, niye fail.
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Env validation failed:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

// Test ortamı için reset
export function resetEnvCache(): void {
  cached = null;
}
