// ============================================================
// Safety Gate
// ============================================================
// Reply gönderilmeden önce SON kontrol katmanı.
// Burası kural motoru ve LLM'in üstünde duran independent kontrol.
//
// Kurallar:
// 1. Reply max 2 cümle (brifindeki kural 10)
// 2. Reply boş veya çok kısa olmamalı
// 3. Reply token/secret içermemeli (paranoid check)
// 4. Reply'de PII (telefon, mail) olmamalı
// 5. Reply 220 karakter sınırı (brifindeki "kısa cümle")
// 6. Fiyat verme intent'inde reply içinde gerçek bir sayı olmalı
//    (yanlışlıkla "Başkan {price} TL" gibi unresolved template
//     gitmesin)
// ============================================================

import { MAX_REPLY_LENGTH_CHARS, INTENTS, type Intent } from '../../config/constants.js';
import { containsTurkishPhone } from '../normalizer/text-normalizer.js';

export interface SafetyCheckInput {
  replyText: string | null;
  intent: Intent;
  city: string | null;
}

export interface SafetyCheckResult {
  passed: boolean;
  reasons: string[];
  // Reply'i geçirsek bile düzeltme gerekiyorsa
  sanitizedReply?: string;
}

const FORBIDDEN_PATTERNS: RegExp[] = [
  // Unresolved template placeholders
  /\{[a-zA-Z_]+\}/g,
  // E-mail
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  // Açıkça token/key gibi görünenler
  /\b(api[_-]?key|access[_-]?token|secret|password)\b/i,
  // 16+ haneli sayı dizisi (kart no benzeri)
  /\b\d{13,}\b/g,
];

const CUSS_PATTERNS: RegExp[] = [
  // Bot'un kendisi cevap içinde küfretmesi imkansız bir scenario gibi görünür ama
  // LLM hallüsinasyonunda kapı altından girebilir.
  /\b(sik|amk|aq|orospu|piç)\b/i,
];

export function runSafetyGate(input: SafetyCheckInput): SafetyCheckResult {
  const reasons: string[] = [];
  const { replyText, intent } = input;

  if (!replyText || replyText.trim().length === 0) {
    // null reply legitimate olabilir (örn. SPAM_OR_ABUSE intent'i)
    if (intent === INTENTS.SPAM_OR_ABUSE || intent === INTENTS.OFF_TOPIC) {
      return { passed: true, reasons: ['no_reply_intentional'] };
    }
    return { passed: false, reasons: ['empty_reply'] };
  }

  // 1. Uzunluk
  if (replyText.length > MAX_REPLY_LENGTH_CHARS) {
    reasons.push(`reply_too_long (${replyText.length} > ${MAX_REPLY_LENGTH_CHARS})`);
  }

  // 2. Cümle sayısı (kabaca nokta/!/? sayısı)
  const sentenceCount = (replyText.match(/[.!?]+/g) || []).length;
  if (sentenceCount > 3) {
    reasons.push(`too_many_sentences (${sentenceCount})`);
  }

  // 3. Yasak pattern'lar
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(replyText)) {
      reasons.push(`forbidden_pattern_matched: ${pattern.source.substring(0, 30)}`);
    }
  }

  // 4. Küfür kontrolü (bot tarafından üretilen)
  for (const pattern of CUSS_PATTERNS) {
    if (pattern.test(replyText)) {
      reasons.push('cuss_in_reply');
    }
  }

  // 5. Telefon kontrolü
  if (containsTurkishPhone(replyText)) {
    reasons.push('phone_number_in_reply');
  }

  // 6. Fiyat verme intent'inde gerçek sayı olmalı
  if (intent === INTENTS.ASK_PRICE_WITH_CITY || intent === INTENTS.PROVIDE_CITY) {
    const hasPrice = /\d{1,3}([.,]\d{3})+\s*TL/i.test(replyText) || /\d{4,}\s*TL/i.test(replyText);
    if (!hasPrice) {
      reasons.push('price_intent_without_number');
    }
  }

  // 7. "Başkan" kelimesi yoksa uyarı (brand voice kontrolü, hard fail değil ama log)
  if (!/başkan/i.test(replyText)) {
    reasons.push('warning_missing_brand_voice');
  }

  // "warning_*" ile başlayanlar hard fail değil
  const hardFailReasons = reasons.filter((r) => !r.startsWith('warning_'));

  return {
    passed: hardFailReasons.length === 0,
    reasons,
  };
}
