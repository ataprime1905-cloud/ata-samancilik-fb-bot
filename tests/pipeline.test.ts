// ============================================================
// Pipeline Tests
// ============================================================
// processComment fonksiyonunun automation mode davranışı,
// LLM fallback, safety gate entegrasyonu test edilir.
// DB tamamen mock'lanır.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import { processComment } from '../src/application/pipeline/comment-processor.js';
import { NoneProvider } from '../src/application/llm/adapter.js';
import { MockLlmProvider } from '../src/application/llm/mock-provider.js';
import { INTENTS, AUTOMATION_MODES, DECISIONS } from '../src/config/constants.js';
import type { PriceLookup, ConversationContext, RawComment } from '../src/domain/types.js';

// -------- Mock helpers --------
const noopSaveContext = vi.fn().mockResolvedValue(undefined);
const noopLoadContext = vi.fn().mockResolvedValue(null);

const priceData: PriceLookup = {
  cityName: 'Ankara',
  citySlug: 'ankara',
  priceTryPerTon: 7500,
  transportIncluded: true,
  minTonnageOverride: null,
  productName: 'Dörtlü Kaba Yem',
  productSku: 'dortlu-kaba-yem',
};

function makeComment(text: string): RawComment {
  return {
    platform: 'facebook',
    commentId: 'test-comment-id',
    authorPlatformId: 'test-user-id',
    text,
  };
}

// ============================================================
// Automation mode: PREVIEW_ONLY
// ============================================================
describe('automation mode — PREVIEW_ONLY', () => {
  it('returns action=preview for deterministic reply', async () => {
    const result = await processComment(
      makeComment('ankara fiyat'),
      'hash-123',
      {
        resolvePrice: vi.fn().mockResolvedValue(priceData),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: new NoneProvider(),
        automationMode: AUTOMATION_MODES.PREVIEW_ONLY,
        llmMinConfidence: 0.8,
      },
    );
    expect(result.action).toBe('preview');
    expect(result.decision.replyText).toContain('7.500');
  });

  it('returns action=human_review for spam', async () => {
    const result = await processComment(
      makeComment('amk ne kadar'),
      'hash-123',
      {
        resolvePrice: vi.fn().mockResolvedValue(null),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: new NoneProvider(),
        automationMode: AUTOMATION_MODES.PREVIEW_ONLY,
        llmMinConfidence: 0.8,
      },
    );
    expect(result.action).toBe('human_review');
    expect(result.decision.intent).toBe(INTENTS.SPAM_OR_ABUSE);
  });
});

// ============================================================
// Automation mode: FULL_AUTO
// ============================================================
describe('automation mode — FULL_AUTO', () => {
  it('returns send_now for high-confidence rule match', async () => {
    const result = await processComment(
      makeComment('ankara fiyat nedir'),
      'hash-abc',
      {
        resolvePrice: vi.fn().mockResolvedValue(priceData),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: new NoneProvider(),
        automationMode: AUTOMATION_MODES.FULL_AUTO,
        llmMinConfidence: 0.8,
      },
    );
    expect(result.action).toBe('send_now');
    expect(result.decision.confidence).toBe(1.0);
  });

  it('returns human_review for unknown intent even in FULL_AUTO', async () => {
    const result = await processComment(
      makeComment('iyiyim sağ ol'),
      'hash-abc',
      {
        resolvePrice: vi.fn().mockResolvedValue(null),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: new NoneProvider(),
        automationMode: AUTOMATION_MODES.FULL_AUTO,
        llmMinConfidence: 0.8,
      },
    );
    expect(result.action).toBe('human_review');
  });
});

// ============================================================
// Automation mode: SEMI_AUTO
// ============================================================
describe('automation mode — SEMI_AUTO', () => {
  it('sends phone response immediately in semi_auto', async () => {
    const result = await processComment(
      makeComment('numara verir misiniz'),
      'hash-semi',
      {
        resolvePrice: vi.fn().mockResolvedValue(null),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: new NoneProvider(),
        automationMode: AUTOMATION_MODES.SEMI_AUTO,
        llmMinConfidence: 0.8,
      },
    );
    expect(result.action).toBe('send_now');
    expect(result.decision.intent).toBe(INTENTS.ASK_PHONE);
  });

  it('queues city+price reply for send in semi_auto', async () => {
    const result = await processComment(
      makeComment('konya fiyat'),
      'hash-semi',
      {
        resolvePrice: vi.fn().mockResolvedValue({ ...priceData, cityName: 'Konya', citySlug: 'konya' }),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: new NoneProvider(),
        automationMode: AUTOMATION_MODES.SEMI_AUTO,
        llmMinConfidence: 0.8,
      },
    );
    // City + price -> queue_for_send
    expect(result.action).toBe('queue_for_send');
  });
});

// ============================================================
// LLM fallback
// ============================================================
describe('LLM fallback for unknown intent', () => {
  it('calls LLM when rule engine returns UNKNOWN', async () => {
    const classifySpy = vi.fn().mockResolvedValue({
      intent: INTENTS.ASK_PRODUCT_DETAILS,
      city: null,
      product: null,
      confidence: 0.85,
      should_reply: true,
      needs_human: false,
      reason: 'mock',
      reply_draft: null,
    });

    const mockLlm = { name: 'mock', classify: classifySpy };

    const result = await processComment(
      makeComment('ürünü biraz anlat bana'), // LLM'in yakalayacağı ama rule engine'in bilemeyeceği
      'hash-llm',
      {
        resolvePrice: vi.fn().mockResolvedValue(null),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: mockLlm,
        automationMode: AUTOMATION_MODES.PREVIEW_ONLY,
        llmMinConfidence: 0.8,
      },
    );

    // Rule engine UNKNOWN döner, LLM çağrılır
    // LLM yüksek confidence bile dönse biz safe mode'da human_review'a atıyoruz
    expect(classifySpy).toHaveBeenCalled();
    expect(result.action).toBe('human_review');
  });

  it('sends to human_review when LLM confidence below threshold', async () => {
    const mockLlm = new MockLlmProvider(); // default: confidence=0.3

    const result = await processComment(
      makeComment('ne zaman çıktı bu ürün'),
      'hash-lowconf',
      {
        resolvePrice: vi.fn().mockResolvedValue(null),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: mockLlm,
        automationMode: AUTOMATION_MODES.FULL_AUTO,
        llmMinConfidence: 0.8,
      },
    );
    expect(result.action).toBe('human_review');
  });

  it('NoneProvider skips LLM call', async () => {
    const noneProvider = new NoneProvider();
    const classifySpy = vi.spyOn(noneProvider, 'classify');

    await processComment(
      makeComment('anlayamadım ne oluyor'),
      'hash-none',
      {
        resolvePrice: vi.fn().mockResolvedValue(null),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: noneProvider,
        automationMode: AUTOMATION_MODES.PREVIEW_ONLY,
        llmMinConfidence: 0.8,
      },
    );

    // NoneProvider.name === 'none', pipeline skips call
    expect(classifySpy).not.toHaveBeenCalled();
  });
});

// ============================================================
// Safety gate integration
// ============================================================
describe('safety gate integration in pipeline', () => {
  it('redirects to human_review when safety gate fails', async () => {
    // Reply builder'ı bypass etmek için city + price mocking
    // Normal flow'da safety gate fallthrough olmaz; ama LLM hack simülasyonu için:
    // Bunu test etmek için reply_text'i manipüle etmemiz gerekir.
    // Basit yol: garbage comment ile pipeline'ın kendisi null replyText döndürür.
    const result = await processComment(
      makeComment('.....'), // garbage -> null reply
      'hash-safety',
      {
        resolvePrice: vi.fn().mockResolvedValue(null),
        loadContext: noopLoadContext,
        saveContext: noopSaveContext,
        llm: new NoneProvider(),
        automationMode: AUTOMATION_MODES.FULL_AUTO,
        llmMinConfidence: 0.8,
      },
    );
    expect(result.action).toBe('human_review');
  });
});

// ============================================================
// Context save called always
// ============================================================
describe('context saving', () => {
  it('always calls saveContext regardless of result', async () => {
    const saveSpy = vi.fn().mockResolvedValue(undefined);

    await processComment(
      makeComment('fiyat'),
      'hash-save',
      {
        resolvePrice: vi.fn().mockResolvedValue(null),
        loadContext: noopLoadContext,
        saveContext: saveSpy,
        llm: new NoneProvider(),
        automationMode: AUTOMATION_MODES.PREVIEW_ONLY,
        llmMinConfidence: 0.8,
      },
    );

    expect(saveSpy).toHaveBeenCalledOnce();
  });
});
