// ============================================================
// Mock LLM Provider
// ============================================================
// Test/development modunda kullanılır. Deterministic kurallı.
// Üretimde NoneProvider veya gerçek bir provider kullanılmalı.
//
// Bu mock, rule engine'in unknown dönmediği durumları taklit edecek
// bir kaç basit pattern içerir (örneğin "açıklayıcı" Türkçe yorumlar).
// ============================================================

import type { LlmProvider, LlmClassification } from './adapter.js';
import { INTENTS } from '../../config/constants.js';
import { normalizeAscii } from '../normalizer/text-normalizer.js';

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';

  async classify(commentText: string): Promise<LlmClassification> {
    const t = normalizeAscii(commentText);

    // Mock heuristics: "anlat" / "açıkla" gibi serbest sorular -> ask_product_details
    if (/\b(anlat|aciklayin|açıklayın|nedir bu|ne ise yarar|nasıl bir|nasil bir)\b/.test(t)) {
      return {
        intent: INTENTS.ASK_PRODUCT_DETAILS,
        city: null,
        product: 'Dörtlü Kaba Yem',
        confidence: 0.85,
        should_reply: true,
        needs_human: false,
        reason: 'mock: product details inquiry',
        reply_draft: null,
      };
    }

    // Belirsiz teşekkür/onay
    if (/\b(tesekkur|teşekkür|sagol|sağol|tamam)\b/.test(t)) {
      return {
        intent: INTENTS.OFF_TOPIC,
        city: null,
        product: null,
        confidence: 0.9,
        should_reply: false,
        needs_human: false,
        reason: 'mock: acknowledgment, no reply needed',
        reply_draft: null,
      };
    }

    // Default: low confidence unknown -> human review
    return {
      intent: INTENTS.UNKNOWN,
      city: null,
      product: null,
      confidence: 0.3,
      should_reply: false,
      needs_human: true,
      reason: 'mock: could not classify',
      reply_draft: null,
    };
  }
}
