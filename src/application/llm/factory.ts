// ============================================================
// LLM Provider Factory
// ============================================================
// Env'deki LLM_PROVIDER değerine göre uygun provider'ı oluşturur.
// FAZ 2'de openai/anthropic/google/cohere provider'ları eklenir.
// Şu an mock + none var.
// ============================================================

import { loadEnv } from '../../config/env.js';
import { NoneProvider, type LlmProvider } from './adapter.js';
import { MockLlmProvider } from './mock-provider.js';

let cached: LlmProvider | null = null;

export function getLlmProvider(): LlmProvider {
  if (cached) return cached;
  const env = loadEnv();
  switch (env.LLM_PROVIDER) {
    case 'none':
      cached = new NoneProvider();
      break;
    case 'mock':
      cached = new MockLlmProvider();
      break;
    // FAZ 2: openai, anthropic, google, cohere
    case 'openai':
    case 'anthropic':
    case 'google':
    case 'cohere':
      // Henüz implement edilmedi; güvenli fallback olarak none
      // (LLM olmadan da sistem çalışmalı: kural motoru ana karar verici)
      cached = new NoneProvider();
      break;
    default:
      cached = new NoneProvider();
  }
  return cached;
}

export function resetLlmProvider(): void {
  cached = null;
}
