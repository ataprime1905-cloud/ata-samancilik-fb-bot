// ============================================================
// LLM Adapter
// ============================================================
// LLM YALNIZCA intent classification için kullanılır.
// - Fiyat hesaplamaz
// - Ürün uydurmaz
// - Şehir fiyat tablosuna bakmaz
// - Nihai cevabı tek başına vermez
//
// Strict JSON schema dönüşü zorunlu. Şüpheli/low-confidence
// dönüşler human_review'a yönlendirilir.
//
// PII MİNİMİZASYONU:
// - LLM'e kullanıcı ID, profil adı, token, sayfa ID GÖNDERİLMEZ
// - Sadece yorum metni gönderilir (gerekirse maskeleme de yapılır)
// ============================================================

import { z } from 'zod';
import type { Intent } from '../../config/constants.js';
import { INTENTS } from '../../config/constants.js';

const INTENT_VALUES = Object.values(INTENTS) as [Intent, ...Intent[]];

export const llmClassificationSchema = z.object({
  intent: z.enum(INTENT_VALUES),
  city: z.string().nullable(),
  product: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  should_reply: z.boolean(),
  needs_human: z.boolean(),
  reason: z.string(),
  reply_draft: z.string().nullable(),
});

export type LlmClassification = z.infer<typeof llmClassificationSchema>;

export interface LlmProvider {
  readonly name: string;
  classify(commentText: string): Promise<LlmClassification>;
}

/**
 * LLM sistem prompt'u — minimum bilgi, strict JSON,
 * fiyat/ürün uydurma yasak, default ürün adı verili.
 *
 * NOT: Fiyat listesi prompt'a EMBED EDİLMEZ. Sadece intent classification.
 */
export const LLM_SYSTEM_PROMPT = `Sen Ata Samancılık Facebook yorum otomasyonu için intent classifier'sın.
Görevin: kullanıcının Türkçe yorumunu analiz edip, aşağıdaki strict JSON formatında çıktı vermek.

KURALLAR:
1. Sadece JSON döndür, başka metin yazma.
2. Fiyat HESAPLAMA, fiyat üretme, ürün uydurma YASAK.
3. Default ürün: "Dörtlü Kaba Yem". Başka ürün adı geçiyorsa product alanına yaz, but unknown ürünse intent="ask_other_product".
4. Şehir tespit edersen city alanına Türkçe canonical adıyla yaz (ör: "Şanlıurfa"). Tespit edemezsen null.
5. Confidence 0..1; emin değilsen 0.5'in altında olsun, needs_human=true yap.
6. Saldırgan/spam/anlamsız yorumda intent="spam_or_abuse", needs_human=true, reply_draft=null.

ÇIKTI SCHEMA:
{
  "intent": "ask_price_generic" | "provide_city" | "ask_price_with_city" | "complain_expensive" | "ask_tonnage" | "ask_minimum_tonnage" | "ask_phone" | "bargain" | "ask_product_details" | "ask_shipping" | "ask_other_product" | "spam_or_abuse" | "off_topic" | "unknown",
  "city": string | null,
  "product": string | null,
  "confidence": number (0..1),
  "should_reply": boolean,
  "needs_human": boolean,
  "reason": string,
  "reply_draft": string | null
}`;

/**
 * "none" provider — LLM çağrısı yapmaz, her zaman unknown döner.
 * Sistem AUTOMATION_MODE=preview_only olduğunda veya LLM disabled olduğunda kullanılır.
 */
export class NoneProvider implements LlmProvider {
  readonly name = 'none';
  async classify(_commentText: string): Promise<LlmClassification> {
    return {
      intent: INTENTS.UNKNOWN,
      city: null,
      product: null,
      confidence: 0,
      should_reply: false,
      needs_human: true,
      reason: 'llm_disabled',
      reply_draft: null,
    };
  }
}
