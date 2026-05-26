// ============================================================
// Reply Builder Tests
// ============================================================
// buildReply fonksiyonu saf; test için DB ve infra yok.
// ============================================================

import { describe, it, expect } from 'vitest';
import { buildReply } from '../src/application/rule-engine/reply-builder.js';
import { INTENTS } from '../src/config/constants.js';
import type { PriceLookup } from '../src/domain/types.js';

const price = (city: string, amount: number): PriceLookup => ({
  cityName: city,
  citySlug: city.toLowerCase(),
  priceTryPerTon: amount,
  transportIncluded: true,
  minTonnageOverride: null,
  productName: 'Dörtlü Kaba Yem',
  productSku: 'dortlu-kaba-yem',
});

describe('buildReply — ASK_PRICE_GENERIC', () => {
  it('returns il sorma cevabı', () => {
    const r = buildReply({ intent: INTENTS.ASK_PRICE_GENERIC, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toContain('hangi il');
    expect(r.needsHuman).toBe(false);
  });
});

describe('buildReply — ASK_PRICE_WITH_CITY', () => {
  it('formats reply with city name and price in TR locale', () => {
    const r = buildReply({
      intent: INTENTS.ASK_PRICE_WITH_CITY,
      modifiers: [],
      city: 'Samsun',
      priceLookup: price('Samsun', 8000),
    });
    expect(r.text).toContain('Samsun teslim');
    expect(r.text).toContain('8.000 TL');
    expect(r.text).toContain('nakliye dahil');
    expect(r.text).toContain('başkan');
    expect(r.needsHuman).toBe(false);
  });

  it('appends fixed-price notice when BARGAIN modifier present', () => {
    const r = buildReply({
      intent: INTENTS.ASK_PRICE_WITH_CITY,
      modifiers: [INTENTS.BARGAIN],
      city: 'Konya',
      priceLookup: price('Konya', 7500),
    });
    expect(r.text).toContain('7.500 TL');
    expect(r.text).toContain('Fiyatlarımız sabit');
  });

  it('returns human review when priceLookup is null (city not in list)', () => {
    const r = buildReply({
      intent: INTENTS.ASK_PRICE_WITH_CITY,
      modifiers: [],
      city: 'Şırnak',
      priceLookup: null,
    });
    expect(r.needsHuman).toBe(true);
    expect(r.humanReason).toBe('unknown_city');
  });
});

describe('buildReply — COMPLAIN_EXPENSIVE', () => {
  it('returns 4\u2019lü karma rasyon explanation with thumbs up emoji', () => {
    const r = buildReply({ intent: INTENTS.COMPLAIN_EXPENSIVE, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toContain('4\u2019lü karma rasyon');
    expect(r.text).toContain('👍');
    expect(r.needsHuman).toBe(false);
  });
});

describe('buildReply — ASK_TONNAGE', () => {
  it('returns TIR tonnage info', () => {
    const r = buildReply({ intent: INTENTS.ASK_TONNAGE, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toContain('TIR bazlıdır');
    expect(r.text).toContain('25-26 ton');
  });
});

describe('buildReply — ASK_MINIMUM_TONNAGE', () => {
  it('returns "hangi il?" when no city', () => {
    const r = buildReply({ intent: INTENTS.ASK_MINIMUM_TONNAGE, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toContain('hangi il');
    expect(r.needsHuman).toBe(false);
  });

  it('returns Ege response for İzmir', () => {
    const r = buildReply({ intent: INTENTS.ASK_MINIMUM_TONNAGE, modifiers: [], city: 'İzmir', priceLookup: null });
    expect(r.text).toContain('Ege');
    expect(r.text).toContain('10 ton');
  });

  it('returns standard TIR response for non-Ege city', () => {
    const r = buildReply({ intent: INTENTS.ASK_MINIMUM_TONNAGE, modifiers: [], city: 'Ankara', priceLookup: null });
    expect(r.text).toContain('TIR');
    expect(r.text).not.toContain('Ege');
  });

  it('Ege cities covered: Aydın, Denizli, Manisa', () => {
    for (const city of ['Aydın', 'Denizli', 'Manisa']) {
      const r = buildReply({ intent: INTENTS.ASK_MINIMUM_TONNAGE, modifiers: [], city, priceLookup: null });
      expect(r.text, `${city} should get Ege response`).toContain('Ege');
    }
  });
});

describe('buildReply — ASK_PHONE', () => {
  it('returns messaging instruction', () => {
    const r = buildReply({ intent: INTENTS.ASK_PHONE, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toContain('Mesaj bırakın');
    expect(r.text).toContain('👍');
    expect(r.needsHuman).toBe(false);
  });
});

describe('buildReply — BARGAIN (standalone)', () => {
  it('returns fixed price message without city price', () => {
    const r = buildReply({ intent: INTENTS.BARGAIN, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toContain('sabit');
    expect(r.needsHuman).toBe(false);
  });
});

describe('buildReply — ASK_PRODUCT_DETAILS', () => {
  it('returns composition percentages', () => {
    const r = buildReply({ intent: INTENTS.ASK_PRODUCT_DETAILS, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toContain('mısır silajı');
    expect(r.text).toContain('%50');
    expect(r.needsHuman).toBe(false);
  });
});

describe('buildReply — ASK_SHIPPING', () => {
  it('returns shipping details with nakliye dahil', () => {
    const r = buildReply({ intent: INTENTS.ASK_SHIPPING, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toContain('TIR');
    expect(r.text).toContain('nakliye dahil');
  });
});

describe('buildReply — ASK_OTHER_PRODUCT', () => {
  it('returns human review with unknown_product reason', () => {
    const r = buildReply({ intent: INTENTS.ASK_OTHER_PRODUCT, modifiers: [], city: null, priceLookup: null });
    expect(r.needsHuman).toBe(true);
    expect(r.humanReason).toBe('unknown_product');
  });
});

describe('buildReply — SPAM_OR_ABUSE', () => {
  it('returns null text and human review', () => {
    const r = buildReply({ intent: INTENTS.SPAM_OR_ABUSE, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toBeNull();
    expect(r.needsHuman).toBe(true);
    expect(r.humanReason).toBe('spam_or_abuse');
  });
});

describe('buildReply — OFF_TOPIC', () => {
  it('returns null text and human review', () => {
    const r = buildReply({ intent: INTENTS.OFF_TOPIC, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toBeNull();
    expect(r.needsHuman).toBe(true);
  });
});

describe('buildReply — UNKNOWN', () => {
  it('returns null text and human review', () => {
    const r = buildReply({ intent: INTENTS.UNKNOWN, modifiers: [], city: null, priceLookup: null });
    expect(r.text).toBeNull();
    expect(r.needsHuman).toBe(true);
  });
});
