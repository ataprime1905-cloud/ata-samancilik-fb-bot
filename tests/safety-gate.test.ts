// ============================================================
// Safety Gate Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { runSafetyGate } from '../src/application/safety/safety-gate.js';
import { INTENTS } from '../src/config/constants.js';

describe('safety gate — null reply handling', () => {
  it('passes when intent=SPAM_OR_ABUSE and reply=null', () => {
    const r = runSafetyGate({ replyText: null, intent: INTENTS.SPAM_OR_ABUSE, city: null });
    expect(r.passed).toBe(true);
    expect(r.reasons).toContain('no_reply_intentional');
  });

  it('passes when intent=OFF_TOPIC and reply=null', () => {
    const r = runSafetyGate({ replyText: null, intent: INTENTS.OFF_TOPIC, city: null });
    expect(r.passed).toBe(true);
  });

  it('fails when intent=ASK_PHONE and reply=null', () => {
    const r = runSafetyGate({ replyText: null, intent: INTENTS.ASK_PHONE, city: null });
    expect(r.passed).toBe(false);
    expect(r.reasons).toContain('empty_reply');
  });
});

describe('safety gate — valid replies pass', () => {
  it('standard price reply passes', () => {
    const r = runSafetyGate({
      replyText: 'Samsun teslim Dörtlü Kaba Yem fiyatımız ton bazlı nakliye dahil 8.000 TL başkan.',
      intent: INTENTS.ASK_PRICE_WITH_CITY,
      city: 'Samsun',
    });
    expect(r.passed).toBe(true);
  });

  it('tonnage reply passes', () => {
    const r = runSafetyGate({
      replyText: 'Sevkiyatlarımız TIR bazlıdır başkan ortalama 25-26 ton gönderim sağlıyoruz.',
      intent: INTENTS.ASK_TONNAGE,
      city: null,
    });
    expect(r.passed).toBe(true);
  });
});

describe('safety gate — length check', () => {
  it('fails when reply exceeds 220 chars', () => {
    const longReply = 'başkan ' + 'x'.repeat(220);
    const r = runSafetyGate({
      replyText: longReply,
      intent: INTENTS.ASK_PRODUCT_DETAILS,
      city: null,
    });
    expect(r.passed).toBe(false);
    expect(r.reasons.some((s) => s.startsWith('reply_too_long'))).toBe(true);
  });
});

describe('safety gate — forbidden patterns', () => {
  it('fails on unresolved template placeholder', () => {
    const r = runSafetyGate({
      replyText: 'Fiyatımız {price} TL başkan.',
      intent: INTENTS.ASK_PRICE_WITH_CITY,
      city: 'Ankara',
    });
    expect(r.passed).toBe(false);
    expect(r.reasons.some((s) => s.includes('forbidden_pattern'))).toBe(true);
  });

  it('fails when reply contains email address', () => {
    const r = runSafetyGate({
      replyText: 'info@atasamancilik.com adresinden ulaşabilirsiniz başkan.',
      intent: INTENTS.ASK_PHONE,
      city: null,
    });
    expect(r.passed).toBe(false);
  });
});

describe('safety gate — price intent without number fails', () => {
  it('fails when price intent reply has no number', () => {
    const r = runSafetyGate({
      replyText: 'Başkan ürünümüz harika kalitede.',
      intent: INTENTS.ASK_PRICE_WITH_CITY,
      city: 'Ankara',
    });
    expect(r.passed).toBe(false);
    expect(r.reasons).toContain('price_intent_without_number');
  });
});

describe('safety gate — phone number in reply fails', () => {
  it('fails when reply contains a Turkish phone number', () => {
    const r = runSafetyGate({
      replyText: 'Bizi 0532 123 45 67 başkan arayın.',
      intent: INTENTS.ASK_PHONE,
      city: null,
    });
    expect(r.passed).toBe(false);
    expect(r.reasons).toContain('phone_number_in_reply');
  });
});

describe('safety gate — brand voice check (warning only)', () => {
  it('passes but warns if "başkan" missing', () => {
    const r = runSafetyGate({
      replyText: 'Mesaj bırakın hemen dönelim 👍',
      intent: INTENTS.ASK_PHONE,
      city: null,
    });
    // Hard fail olmamalı ama warning olmalı
    expect(r.passed).toBe(true);
    expect(r.reasons).toContain('warning_missing_brand_voice');
  });
});
