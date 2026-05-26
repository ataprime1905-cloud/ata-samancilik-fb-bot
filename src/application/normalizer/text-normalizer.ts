// ============================================================
// Text Normalizer
// ============================================================
// Türkçe karakter handling notları:
// - JS'in standart toLowerCase'i Türkçe için BUGGY:
//   "I".toLowerCase() => "i"  (yanlış, "ı" olmalı)
//   "İ".toLowerCase() => "i̇" (combining dot above, bozuk)
//   Bunun için manuel TR-safe lowercase yapıyoruz.
// - Match için iki form üretiyoruz:
//   1. normalizedText: TR karakterleri korur (gösterim/log için)
//   2. asciiText: ASCII fold (matching için)
// ============================================================

/**
 * Türkçe-safe lowercase.
 * "İSTANBUL" -> "istanbul", "I" -> "ı", "İ" -> "i"
 */
export function turkishLowerCase(input: string): string {
  return input
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase();
}

/**
 * ASCII fold: Türkçe karakterleri ASCII karşılıklarına çevirir.
 * Sadece matching için kullanılır, kullanıcıya gösterilmez.
 */
export function asciiFold(input: string): string {
  return input
    .replace(/ç/g, 'c').replace(/Ç/g, 'C')
    .replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ı/g, 'i').replace(/I/g, 'I')
    .replace(/İ/g, 'i').replace(/i̇/g, 'i')
    .replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ş/g, 's').replace(/Ş/g, 'S')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U');
}

/**
 * Emoji ve non-essential unicode'u kaldırır.
 * Sadece yorum parsing için; cevap üretiminde emoji KORUNUR.
 */
export function stripEmoji(input: string): string {
  // Geniş emoji range'leri + variation selector'lar
  return input.replace(
    /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu,
    ' ',
  );
}

/**
 * Whitespace ve noktalama temizliği.
 * Match için fazla noktalama yok; ama "?!." gibi soru sinyallerini koruyabiliriz.
 */
export function cleanupWhitespace(input: string): string {
  return input
    .replace(/[\s\t\n\r]+/g, ' ')
    .replace(/\.{2,}/g, '.') // birden fazla nokta -> tek
    .replace(/!+/g, '!')
    .replace(/\?+/g, '?')
    .trim();
}

/**
 * Tüm normalize pipeline.
 * Match için kullanılacak nihai form.
 */
export function normalizeForMatching(input: string): string {
  const noEmoji = stripEmoji(input);
  const lowered = turkishLowerCase(noEmoji);
  const cleaned = cleanupWhitespace(lowered);
  return cleaned;
}

/**
 * ASCII match için (şehir alias matching'inde kullanışlı).
 */
export function normalizeAscii(input: string): string {
  return asciiFold(normalizeForMatching(input));
}

/**
 * Boş/anlamsız yorum tespiti.
 * "....", "...", "?", "..", tek karakter, sadece emoji vb.
 */
export function isEmptyOrGarbage(input: string): boolean {
  const stripped = stripEmoji(input).replace(/[^\p{L}\p{N}]/gu, '').trim();
  if (stripped.length === 0) return true;
  if (stripped.length < 2) return true;
  return false;
}

/**
 * Şehir slug üretici (DB'de citySlug için).
 * "Şanlıurfa" -> "sanliurfa"
 * "Afyonkarahisar" -> "afyonkarahisar"
 */
export function slugifyTurkish(input: string): string {
  return asciiFold(turkishLowerCase(input))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Türk telefon numarası tespiti (PII flag için).
 * 5xx xxx xx xx veya +90 5xx ... formları.
 */
export function containsTurkishPhone(input: string): boolean {
  const cleaned = input.replace(/[\s\-().]/g, '');
  return /(?:\+?90)?5\d{9}/.test(cleaned);
}

/**
 * Türkçe binlik ayırıcılı fiyat formatı.
 * 7500 -> "7.500", 8000 -> "8.000", 8500 -> "8.500"
 */
export function formatPriceTr(amount: number): string {
  // tr-TR yerel ayar kullan; ondalık yok (ton fiyatı integer).
  return amount.toLocaleString('tr-TR', { useGrouping: true, maximumFractionDigits: 0 });
}
