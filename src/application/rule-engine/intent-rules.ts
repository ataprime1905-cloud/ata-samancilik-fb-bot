// ============================================================
// Intent Rules
// ============================================================
// Brifindeki 16 yanıt kuralından türetilmiş deterministic pattern set.
// Her pattern, normalize edilmiş input üzerinde test edilir.
// Composite intent (city + bargain) için resolveIntent fonksiyonu kullanılır.
// ============================================================

import { INTENTS, type Intent, ABUSE_KEYWORDS, OFF_TOPIC_KEYWORDS } from '../../config/constants.js';
import { normalizeForMatching, normalizeAscii, isEmptyOrGarbage } from '../normalizer/text-normalizer.js';

// Her pattern test fonksiyonu input'u ASCII-folded ve TR-lowercase formda alır
export interface IntentPattern {
  intent: Intent;
  // Her keyword/phrase için exact substring match (word boundary kontrollü)
  // Aşağıda match() fonksiyonu word boundary kontrolünü yapıyor
  keywords: string[];
  // Bazı niyetler birden çok keyword'ün KESİŞİMİNİ gerektirir
  // (örnek: minimum tonnage = "minimum" + "ton" gibi)
  // Şimdilik OR mantığıyla yetiyoruz; üretimde AND group eklenebilir.
}

/**
 * Word-boundary aware match — bir keyword input'ta geçiyor mu?
 * "fiyat" geçiyor mu kontrolü "fiyatli" gibi yan kelime kazanmamalı —
 * \b kullanıyoruz.
 */
function hasKeyword(input: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Çok kısa keyword'ler (örn. "az") false-positive yapabilir; min 2 karakter ok
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  return regex.test(input);
}

/**
 * Çoklu keyword: hepsi geçmeli (AND).
 */
function hasAllKeywords(input: string, keywords: string[]): boolean {
  return keywords.every((k) => hasKeyword(input, k));
}

/**
 * En az biri geçmeli (OR).
 */
function hasAnyKeyword(input: string, keywords: string[]): boolean {
  return keywords.some((k) => hasKeyword(input, k));
}

// ============================================================
// Intent detector — input ASCII-folded ve lowercased olarak gelir
// ============================================================

export interface IntentDetectionResult {
  intent: Intent;
  // Aynı yorumda birden fazla intent eş zamanlı geçiyorsa diğerleri
  // composite handling için döndürülür (örn: city + bargain)
  modifiers: Intent[];
  trace: string[];
}

/**
 * Brifindeki kurallara göre tek bir yorumdan birincil + modifier intent'leri tespit eder.
 *
 * Öncelik sırası (yukarıdan aşağıya):
 *  1. spam_or_abuse        — varsa erken çık
 *  2. off_topic            — saldırgan/konu dışı keywordler
 *  3. ask_other_product    — yonca/saman/arpa tek başına soruluyor
 *  4. ask_price_with_city  — şehir varsa (örn. "samsun", "ankara fiyat")
 *  5. ask_price_generic    — şehir yok, sadece fiyat sorusu
 *  6. complain_expensive
 *  7. ask_minimum_tonnage  — kontrol önemli: "kaç ton" öncesi tespit edilmeli
 *  8. ask_tonnage
 *  9. ask_phone
 * 10. bargain              — modifier olarak diğer intent'lere eklenir
 * 11. ask_product_details
 * 12. ask_shipping
 * 13. unknown -> LLM fallback
 *
 * Bargain modifier: city + price + bargain durumunda (örn. "konya olur ama indirim yap"),
 * birincil intent ask_price_with_city, modifier bargain olur. Reply builder
 * fiyatı verir + sabit fiyat mesajını ekler.
 */
export function detectIntent(rawInput: string, hasCity: boolean): IntentDetectionResult {
  const trace: string[] = [];

  if (isEmptyOrGarbage(rawInput)) {
    trace.push('detected: empty_or_garbage');
    return { intent: INTENTS.OFF_TOPIC, modifiers: [], trace };
  }

  const normalized = normalizeForMatching(rawInput);
  const ascii = normalizeAscii(rawInput);

  // 1. Spam / abuse
  if (hasAnyKeyword(ascii, ABUSE_KEYWORDS.map((k) => normalizeAscii(k)))) {
    trace.push('matched: abuse keywords');
    return { intent: INTENTS.SPAM_OR_ABUSE, modifiers: [], trace };
  }

  // 2. Off topic (kaba filtre; üretimde genişler)
  if (hasAnyKeyword(ascii, OFF_TOPIC_KEYWORDS.map((k) => normalizeAscii(k)))) {
    trace.push('matched: off_topic keywords');
    return { intent: INTENTS.OFF_TOPIC, modifiers: [], trace };
  }

  // 3. Başka ürün sorusu (katalog dışı)
  // "yonca", "arpa var mı", "saman var mı"
  // DİKKAT: bu mevcut ürünümüz "dörtlü kaba yem" değil.
  // "saman" tek başına bile katalog dışı sayılır (ürünümüz saman değil).
  const otherProductKeywords = ['yonca', 'arpa', 'saman', 'misir silaji tek', 'silaj tek'];
  const otherProductHit = otherProductKeywords.find((k) => hasKeyword(ascii, k));
  if (otherProductHit) {
    trace.push(`matched: ask_other_product (${otherProductHit})`);
    // Modifier'ları yine de detect et (örn. başka ürün + şehir sorulmuş olabilir)
    const modifiers = detectModifiers(ascii);
    return { intent: INTENTS.ASK_OTHER_PRODUCT, modifiers, trace };
  }

  // 4. Bargain detection (modifier olarak da kullanılır)
  const bargainKeywords = [
    'son olur mu', 'indirim', 'duser mi', 'düşer mi', 'pahalı biraz',
    'pahali biraz', 'en son ne olur', 'en son', 'son fiyat',
  ];
  const hasBargain = bargainKeywords.some((k) => hasKeyword(ascii, normalizeAscii(k)));

  // 5. Pahalı şikayeti (bargain'dan ayrı; bargain "indirim isteme", şikayet "çok pahalı")
  const complainKeywords = ['cok pahali', 'çok pahalı', 'pahali bu', 'bu ne fiyat'];
  const hasComplain = complainKeywords.some((k) => hasKeyword(ascii, normalizeAscii(k)));

  // 6. Tonnage soruları
  const minimumTonnageKeywords = ['minimum', 'az alabilir', 'az olur', '10 ton olur', 'az miktar'];
  const hasMinimumTonnage = minimumTonnageKeywords.some((k) => hasKeyword(ascii, normalizeAscii(k)));

  const tonnageKeywords = ['kac ton', 'kaç ton', 'tir kac', 'tır kaç', 'sevkiyat kac', 'sevkiyat kaç', 'ton geliyor'];
  const hasTonnage = tonnageKeywords.some((k) => hasKeyword(ascii, normalizeAscii(k)));

  // 7. Telefon / iletişim
  const phoneKeywords = ['numara', 'telefon', 'iletisim', 'iletişim', 'arayin', 'arayın', 'nasil ulasiriz', 'nasıl ulaşırız'];
  const hasPhone = phoneKeywords.some((k) => hasKeyword(ascii, normalizeAscii(k)));

  // 8. Ürün detayı sorusu
  const productDetailsKeywords = ['icerik', 'içerik', 'icinde ne', 'içinde ne', 'ne iceriyor', 'ne içeriyor', 'karisim', 'karışım', 'orani', 'oranı', 'protein'];
  const hasProductDetails = productDetailsKeywords.some((k) => hasKeyword(ascii, normalizeAscii(k)));

  // 9. Sevkiyat / kargo
  const shippingKeywords = ['sevkiyat', 'kargo', 'nakliye', 'teslim ne zaman', 'kac gunde', 'kaç günde'];
  const hasShipping = shippingKeywords.some((k) => hasKeyword(ascii, normalizeAscii(k)));

  // 10. Fiyat sorusu (generic)
  const genericPriceKeywords = ['fiyat', 'ne kadar', 'kac para', 'kaç para', 'kac lira', 'kaç lira', 'bilgi', 'fiyatı', 'fiyati', 'ton fiyat'];
  const hasGenericPrice = genericPriceKeywords.some((k) => hasKeyword(ascii, normalizeAscii(k)));

  // ---------------- Karar mantığı ----------------

  // Modifier collection (composite handling)
  const modifiers: Intent[] = [];
  if (hasBargain) modifiers.push(INTENTS.BARGAIN);

  // City varsa fiyat öncelikli (brifindeki rule 2, 3, 7)
  // Sadece "samsun" yazsa bile fiyat ver, "ankara fiyat" da fiyat ver.
  if (hasCity) {
    trace.push('matched: ask_price_with_city (city detected)');
    return { intent: INTENTS.ASK_PRICE_WITH_CITY, modifiers, trace };
  }

  // City yoksa: pahalı şikayeti > tonnage > phone > generic price > bargain > diğer
  if (hasComplain) {
    trace.push('matched: complain_expensive');
    return { intent: INTENTS.COMPLAIN_EXPENSIVE, modifiers, trace };
  }

  if (hasMinimumTonnage) {
    trace.push('matched: ask_minimum_tonnage');
    return { intent: INTENTS.ASK_MINIMUM_TONNAGE, modifiers, trace };
  }

  if (hasTonnage) {
    trace.push('matched: ask_tonnage');
    return { intent: INTENTS.ASK_TONNAGE, modifiers, trace };
  }

  if (hasPhone) {
    trace.push('matched: ask_phone');
    return { intent: INTENTS.ASK_PHONE, modifiers, trace };
  }

  if (hasProductDetails) {
    trace.push('matched: ask_product_details');
    return { intent: INTENTS.ASK_PRODUCT_DETAILS, modifiers, trace };
  }

  if (hasShipping) {
    trace.push('matched: ask_shipping');
    return { intent: INTENTS.ASK_SHIPPING, modifiers, trace };
  }

  if (hasGenericPrice) {
    trace.push('matched: ask_price_generic');
    return { intent: INTENTS.ASK_PRICE_GENERIC, modifiers, trace };
  }

  if (hasBargain) {
    // City olmadan tek başına bargain (örn. "indirim olur mu")
    trace.push('matched: bargain (no city)');
    return { intent: INTENTS.BARGAIN, modifiers: [], trace };
  }

  // Yakalanmadı: LLM fallback için unknown
  trace.push('no rule matched -> unknown');
  return { intent: INTENTS.UNKNOWN, modifiers, trace };
}

/**
 * Sadece modifier'ları detect eder (bargain).
 * Birincil intent zaten belli olduğunda yan etkileri toplamak için.
 */
function detectModifiers(ascii: string): Intent[] {
  const mods: Intent[] = [];
  const bargainKeywords = ['son olur', 'indirim', 'duser', 'düşer', 'pahali biraz', 'pahalı biraz', 'en son'];
  if (bargainKeywords.some((k) => hasKeyword(ascii, normalizeAscii(k)))) {
    mods.push(INTENTS.BARGAIN);
  }
  return mods;
}
