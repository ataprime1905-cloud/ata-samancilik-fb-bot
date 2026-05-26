// ============================================================
// Comment Processing Pipeline
// ============================================================
// Tam akış:
// 1. Idempotency check (comment_id daha önce işlendi mi?)
// 2. Comment normalize + persist (raw)
// 3. Rule engine çalıştır
// 4. Rule engine UNKNOWN dönerse LLM fallback
// 5. Safety gate
// 6. Automation mode'a göre karar (preview/semi/full)
// 7. Reply gönder veya queue'ya ekle veya human_review'a at
// 8. comment_processing kaydı ve audit log
//
// Bu pipeline'da DB ve external service çağrıları INJECTED.
// Test'lerde mock'lanabilir.
// ============================================================

import { INTENTS, DECISIONS, AUTOMATION_MODES, type AutomationMode } from '../../config/constants.js';
import type {
  RawComment,
  RuleDecision,
  PriceLookup,
  ConversationContext,
} from '../../domain/types.js';
import { runRuleEngine } from '../rule-engine/index.js';
import { runSafetyGate } from '../safety/safety-gate.js';
import type { LlmProvider } from '../llm/adapter.js';

export interface PipelineDependencies {
  resolvePrice: (city: string) => Promise<PriceLookup | null>;
  loadContext: (platform: string, authorHash: string) => Promise<ConversationContext | null>;
  saveContext: (
    platform: string,
    authorHash: string,
    ctx: ConversationContext,
  ) => Promise<void>;
  llm: LlmProvider;
  automationMode: AutomationMode;
  llmMinConfidence: number;
}

export interface PipelineOutput {
  decision: RuleDecision;
  // Bu, otomasyon mode'una göre nihai karardır:
  // - "send_now": canlıya gönder
  // - "queue_for_send": kuyruğa al (semi_auto'da güvenli mesajlar)
  // - "preview": admin panelinde göster, otomatik gönderme
  // - "human_review": insana devret
  // - "ignore": hiçbir şey yapma
  action: 'send_now' | 'queue_for_send' | 'preview' | 'human_review' | 'ignore';
  safetyReasons: string[];
}

export async function processComment(
  comment: RawComment,
  authorHash: string,
  deps: PipelineDependencies,
): Promise<PipelineOutput> {
  // 1. Conversation context yükle
  const context = await deps.loadContext(comment.platform, authorHash);

  // 2. Rule engine
  let decision = await runRuleEngine({
    text: comment.text,
    context,
    resolvePrice: deps.resolvePrice,
  });

  // 3. LLM fallback — sadece rule engine UNKNOWN ve LLM provider mevcutsa
  if (decision.intent === INTENTS.UNKNOWN && deps.llm.name !== 'none') {
    decision.trace.push(`calling LLM: ${deps.llm.name}`);
    try {
      const llmResult = await deps.llm.classify(comment.text);
      decision.trace.push(
        `LLM: intent=${llmResult.intent} confidence=${llmResult.confidence}`,
      );

      // Düşük confidence -> human review
      if (llmResult.confidence < deps.llmMinConfidence || llmResult.needs_human) {
        decision = {
          ...decision,
          intent: llmResult.intent,
          confidence: llmResult.confidence,
          decision: DECISIONS.HUMAN_REVIEW,
          needsHuman: true,
          humanReason: 'low_confidence',
          replyText: null,
        };
      } else {
        // LLM'in önerdiği intent'i alıp rule engine'i TEKRAR çalıştırabilirdik.
        // Ama emin değiliz; LLM hallüsinasyon yapabilir. Bu yüzden:
        // - LLM intent'ini sadece sınıflandırma için kullan
        // - Cevap üretmiyoruz LLM'den (reply_draft kullanmıyoruz)
        // - Eğer intent uygun ve city LLM tarafından detect edildiyse
        //   rule engine'i tekrar runla
        if (llmResult.city) {
          // Re-run with hint: city'yi yapay olarak inject
          // Şu an basit tutuyoruz, sadece human review'a at
          decision.trace.push('LLM detected city but skipping auto-reply for safety');
        }
        decision = {
          ...decision,
          intent: llmResult.intent,
          confidence: llmResult.confidence,
          decision: DECISIONS.HUMAN_REVIEW,
          needsHuman: true,
          humanReason: 'llm_fallback_safe_mode',
          replyText: null,
        };
      }
    } catch (err) {
      decision.trace.push(`LLM error: ${(err as Error).message}`);
      decision = {
        ...decision,
        decision: DECISIONS.HUMAN_REVIEW,
        needsHuman: true,
        humanReason: 'llm_error',
      };
    }
  }

  // 4. Safety gate
  const safety = runSafetyGate({
    replyText: decision.replyText,
    intent: decision.intent,
    city: decision.city,
  });

  if (!safety.passed) {
    decision.trace.push(`safety gate failed: ${safety.reasons.join(', ')}`);
    decision = {
      ...decision,
      decision: DECISIONS.HUMAN_REVIEW,
      needsHuman: true,
      humanReason: 'safety_gate_failed',
      replyText: null,
    };
  }

  // 5. Conversation context güncelle (her halükarda)
  const newContext: ConversationContext = {
    lastCity: decision.city ?? context?.lastCity ?? null,
    lastProductSku: decision.productSku ?? context?.lastProductSku ?? null,
    lastIntent: decision.intent,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
  await deps.saveContext(comment.platform, authorHash, newContext);

  // 6. Automation mode'a göre action
  const action = resolveAction(decision, deps.automationMode);

  return { decision, action, safetyReasons: safety.reasons };
}

function resolveAction(
  decision: RuleDecision,
  mode: AutomationMode,
): PipelineOutput['action'] {
  // Human review baskın
  if (decision.needsHuman || decision.decision === DECISIONS.HUMAN_REVIEW) {
    return 'human_review';
  }
  if (decision.decision === DECISIONS.IGNORE || !decision.replyText) {
    return 'ignore';
  }

  // Reply var ve otomatik gönderilebilir
  switch (mode) {
    case AUTOMATION_MODES.FULL_AUTO:
      // Confidence 1.0 ve rule engine kesin karar -> gönder
      if (decision.confidence >= 1.0) return 'send_now';
      return 'human_review';

    case AUTOMATION_MODES.SEMI_AUTO:
      // Güvenli kategorileri otomatik gönder, riskli olanları kuyrukla
      // Güvenli: phone, tonnage, complain, generic price (city sorma)
      // Riskli: city + price (yanlış il riski)
      if (
        decision.intent === INTENTS.ASK_PHONE ||
        decision.intent === INTENTS.ASK_TONNAGE ||
        decision.intent === INTENTS.COMPLAIN_EXPENSIVE ||
        decision.intent === INTENTS.ASK_PRICE_GENERIC ||
        decision.intent === INTENTS.ASK_PRODUCT_DETAILS
      ) {
        return 'send_now';
      }
      // City + price: queue for human approval ilk başta
      return 'queue_for_send';

    case AUTOMATION_MODES.PREVIEW_ONLY:
    default:
      return 'preview';
  }
}
