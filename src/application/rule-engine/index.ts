// ============================================================
// Rule Engine
// ============================================================
// Orchestrator:
// 1. Yorumu normalize et
// 2. Şehir tespit et
// 3. Intent detect et (deterministic patterns)
// 4. Eğer fiyat veriliyorsa DB'den çek
// 5. Reply'i build et
// 6. Decision (auto_reply / human_review / ignore) hesapla
//
// LLM bu katmanda ÇAĞIRILMAZ. LLM yalnızca pipeline'da
// rule engine UNKNOWN dönerse fallback olarak devreye girer.
// ============================================================

import { INTENTS, DECISIONS, type Decision } from '../../config/constants.js';
import type { PriceLookup, RuleDecision, ConversationContext } from '../../domain/types.js';
import { detectSingleCity } from '../normalizer/city-normalizer.js';
import { normalizeForMatching, isEmptyOrGarbage } from '../normalizer/text-normalizer.js';
import { detectIntent } from './intent-rules.js';
import { buildReply } from './reply-builder.js';

export interface RuleEngineInput {
  text: string;
  // Conversation state ile bağlam: kullanıcı önce "fiyat" sonra "Samsun" yazdıysa,
  // bu sefer şehir tek başına fiyat sorusu olarak yorumlanır
  context?: ConversationContext | null;
  // Fiyat lookup'ını domain dışında yapacağız (DI)
  resolvePrice: (city: string) => Promise<PriceLookup | null>;
}

/**
 * Rule engine'in ana fonksiyonu.
 * Saf domain logic; DB erişimi callback ile yapılır.
 */
export async function runRuleEngine(input: RuleEngineInput): Promise<RuleDecision> {
  const trace: string[] = [];
  const normalized = normalizeForMatching(input.text);
  trace.push(`normalized: "${normalized}"`);

  // Garbage / empty
  if (isEmptyOrGarbage(input.text)) {
    trace.push('empty_or_garbage -> human_review');
    return {
      intent: INTENTS.OFF_TOPIC,
      confidence: 1.0,
      decision: DECISIONS.HUMAN_REVIEW,
      city: null,
      productSku: null,
      replyText: null,
      needsHuman: true,
      humanReason: 'empty_or_garbage',
      trace,
    };
  }

  // Şehir tespiti
  const cityDetection = detectSingleCity(input.text);
  if (cityDetection.ambiguous) {
    trace.push(`multiple cities detected: ${cityDetection.allCities.join(', ')}`);
    return {
      intent: INTENTS.UNKNOWN,
      confidence: 1.0,
      decision: DECISIONS.HUMAN_REVIEW,
      city: null,
      productSku: null,
      replyText: 'Başkan hangi il için net fiyat istemiştiniz?',
      needsHuman: true,
      humanReason: 'multiple_cities',
      trace,
    };
  }

  let detectedCity = cityDetection.city;

  // Intent detect — şehir bilgisini intent kararına dahil et
  const intentResult = detectIntent(input.text, detectedCity !== null);
  trace.push(...intentResult.trace);

  // Conversation context: kullanıcı önceki turda fiyat sorduysa
  // şimdi sadece il yazdıysa, fiyat sorusu olarak yorumla
  if (
    !detectedCity &&
    input.context?.lastIntent === INTENTS.ASK_PRICE_GENERIC &&
    cityDetection.city === null
  ) {
    // Context'te il varsa onu kullan
    if (input.context.lastCity) {
      trace.push(`using city from context: ${input.context.lastCity}`);
      detectedCity = input.context.lastCity;
    }
  }

  // Fiyat lookup'ı sadece city varsa ve ASK_PRICE_WITH_CITY intent'inde
  let priceLookup: PriceLookup | null = null;
  if (detectedCity && intentResult.intent === INTENTS.ASK_PRICE_WITH_CITY) {
    priceLookup = await input.resolvePrice(detectedCity);
    if (!priceLookup) {
      trace.push(`price not found for city: ${detectedCity}`);
      // İl listede yok -> uydurma fiyat verme, human review
      return {
        intent: intentResult.intent,
        confidence: 1.0,
        decision: DECISIONS.HUMAN_REVIEW,
        city: detectedCity,
        productSku: null,
        replyText: 'Başkan bu il için fiyatı netleştirip dönüş sağlayalım.',
        needsHuman: true,
        humanReason: 'unknown_city',
        trace,
      };
    }
    trace.push(`price found: ${priceLookup.priceTryPerTon} TL/ton`);
  }

  // Min tonnage için de city varsa Ege check'i lazım (reply-builder içinde)
  // Reply'i build et
  const reply = buildReply({
    intent: intentResult.intent,
    modifiers: intentResult.modifiers,
    city: detectedCity,
    priceLookup,
  });

  // Decision
  let decision: Decision;
  if (reply.needsHuman) {
    decision = DECISIONS.HUMAN_REVIEW;
  } else if (reply.text === null) {
    decision = DECISIONS.IGNORE;
  } else {
    decision = DECISIONS.AUTO_REPLY;
  }

  // Unknown intent'te confidence düşük; LLM fallback için sinyal
  // Rule engine kesin karar verdiğinde confidence 1.0
  const confidence = intentResult.intent === INTENTS.UNKNOWN ? 0 : 1.0;

  trace.push(`decision: ${decision}, intent: ${intentResult.intent}`);

  return {
    intent: intentResult.intent,
    confidence,
    decision,
    city: detectedCity,
    productSku: priceLookup?.productSku ?? null,
    replyText: reply.text,
    needsHuman: reply.needsHuman,
    humanReason: reply.humanReason,
    trace,
  };
}
