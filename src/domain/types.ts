import type { Intent, Decision, Platform } from '../config/constants.js';

// ============================================================
// Domain types
// ============================================================
// Tasarım: Domain katmanı saf, herhangi bir altyapıdan bağımsız.
// Prisma type'ları infrastructure'da; burada plain TS.
// ============================================================

export interface RawComment {
  platform: Platform;
  commentId: string;
  parentCommentId?: string;
  postId?: string;
  pageOrIgId?: string;
  authorPlatformId: string; // ham id; pipeline hash'leyecek
  authorName?: string;
  text: string;
  permalink?: string;
  createdTimePlatform?: Date;
}

export interface NormalizedComment {
  raw: RawComment;
  normalizedText: string;
  // Türkçe karakter normalize edilmiş, sadece match için kullanılan ASCII form
  asciiText: string;
  detectedCities: string[]; // canonical names ("Şanlıurfa")
  detectedCity: string | null; // tek bir net şehir; multiple varsa null
}

export interface PriceLookup {
  cityName: string;
  citySlug: string;
  priceTryPerTon: number;
  transportIncluded: boolean;
  minTonnageOverride: number | null;
  productName: string;
  productSku: string;
}

export interface RuleDecision {
  intent: Intent;
  confidence: number; // 0..1, deterministic rules için genelde 1.0
  decision: Decision;
  city: string | null;
  productSku: string | null;
  replyText: string | null;
  needsHuman: boolean;
  humanReason: string | null;
  // Açıklama: hangi kural eşleşti, neden böyle karar verildi (debug/audit)
  trace: string[];
}

export interface ConversationContext {
  lastCity: string | null;
  lastProductSku: string | null;
  lastIntent: Intent | null;
  expiresAt: Date;
}

export interface LlmClassification {
  intent: Intent;
  city: string | null;
  product: string | null;
  confidence: number;
  shouldReply: boolean;
  needsHuman: boolean;
  reason: string;
  replyDraft: string | null;
}

export interface PipelineResult {
  decision: RuleDecision;
  replyStatus: 'pending' | 'sent' | 'failed' | 'skipped';
  metaReplyId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

// Meta webhook entry shape (basitleştirilmiş — Pages feed/comments için)
export interface MetaWebhookEntry {
  id: string;
  time: number;
  changes?: Array<{
    field: string;
    value: {
      item?: string;
      verb?: string;
      comment_id?: string;
      post_id?: string;
      parent_id?: string;
      message?: string;
      from?: { id: string; name?: string };
      created_time?: number;
      permalink_url?: string;
    };
  }>;
}

export interface MetaWebhookPayload {
  object: 'page' | 'instagram';
  entry: MetaWebhookEntry[];
}
