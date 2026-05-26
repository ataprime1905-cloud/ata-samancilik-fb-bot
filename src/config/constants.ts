// ============================================================
// Constants — magic string'leri tek yerde topluyoruz
// ============================================================

export const PLATFORMS = {
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
} as const;
export type Platform = (typeof PLATFORMS)[keyof typeof PLATFORMS];

export const INTENTS = {
  ASK_PRICE_GENERIC: 'ask_price_generic',
  PROVIDE_CITY: 'provide_city',
  ASK_PRICE_WITH_CITY: 'ask_price_with_city',
  COMPLAIN_EXPENSIVE: 'complain_expensive',
  ASK_TONNAGE: 'ask_tonnage',
  ASK_MINIMUM_TONNAGE: 'ask_minimum_tonnage',
  ASK_PHONE: 'ask_phone',
  BARGAIN: 'bargain',
  ASK_PRODUCT_DETAILS: 'ask_product_details',
  ASK_SHIPPING: 'ask_shipping',
  ASK_OTHER_PRODUCT: 'ask_other_product',
  SPAM_OR_ABUSE: 'spam_or_abuse',
  OFF_TOPIC: 'off_topic',
  UNKNOWN: 'unknown',
} as const;
export type Intent = (typeof INTENTS)[keyof typeof INTENTS];

export const DECISIONS = {
  AUTO_REPLY: 'auto_reply',
  HUMAN_REVIEW: 'human_review',
  IGNORE: 'ignore',
} as const;
export type Decision = (typeof DECISIONS)[keyof typeof DECISIONS];

export const REPLY_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
  SKIPPED: 'skipped',
} as const;

export const AUTOMATION_MODES = {
  PREVIEW_ONLY: 'preview_only',
  SEMI_AUTO: 'semi_auto',
  FULL_AUTO: 'full_auto',
} as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[keyof typeof AUTOMATION_MODES];

export const HUMAN_REVIEW_REASONS = {
  SPAM_OR_ABUSE: 'spam_or_abuse',
  OFF_TOPIC: 'off_topic',
  UNSAFE: 'unsafe',
  UNKNOWN_CITY: 'unknown_city',
  MULTIPLE_CITIES: 'multiple_cities',
  UNKNOWN_PRODUCT: 'unknown_product',
  LOW_CONFIDENCE: 'low_confidence',
  UNCLEAR_INTENT: 'unclear_intent',
  EMPTY_OR_GARBAGE: 'empty_or_garbage',
  PII_DETECTED: 'pii_detected',
} as const;

// Brifindeki kural: Ege bölgesinde minimum 10 ton
export const EGE_CITIES = new Set([
  'İzmir',
  'Aydın',
  'Manisa',
  'Muğla',
  'Denizli',
  'Uşak',
  'Kütahya',
  'Afyonkarahisar',
]);

// Default product (multi-product gelecekte; MVP'de sabit)
export const DEFAULT_PRODUCT_SKU = 'dortlu-kaba-yem';
export const DEFAULT_PRODUCT_NAME = 'Dörtlü Kaba Yem';

// Cevap maksimum uzunluk (brifteki "1 cümle, max 2 kısa cümle")
export const MAX_REPLY_LENGTH_CHARS = 220;

// Webhook signature header (Meta resmi)
export const META_SIGNATURE_HEADER = 'x-hub-signature-256';

// Spam/abuse keyword'leri (Türkçe ağırlıklı; örnek set, üretimde genişletilir)
// Not: Spesifik küfür listesini koda gömmek hassas; burası placeholder set.
// Üretimde dış config'ten yüklenir, audit edilir.
export const ABUSE_KEYWORDS: ReadonlyArray<string> = [
  'sik',
  'amk',
  'aq',
  'orospu',
  'piç',
  'göt',
  'mal',
  'gerizekalı',
  'salak',
  'aptal',
  'dolandırıcı',
  'sahtekar',
  'çalıyor',
];

// Politik/konu dışı kaba filtre (placeholder; üretimde genişletilir)
export const OFF_TOPIC_KEYWORDS: ReadonlyArray<string> = [
  'siyaset',
  'parti',
  'seçim',
  'futbol',
  'maç skoru',
];
