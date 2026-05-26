// ============================================================
// City Normalizer
// ============================================================
// Brifindeki kural: typo-tolerant city matching mümkünse Levenshtein
// AMA confidence düşükse fiyat verme. MVP'de fuzzy YOK; exact alias match.
// (Fuzzy match yanlış il -> yanlış fiyat riski; FAZ 2'de eklenir.)
// ============================================================

import { normalizeAscii } from './text-normalizer.js';
import { getAllAliasesSortedByLength } from './city-aliases.js';

// Modül başlangıcında tek seferlik build
const SORTED_ALIASES = getAllAliasesSortedByLength();

export interface CityMatch {
  canonical: string;
  alias: string;
  start: number;
  end: number;
}

/**
 * Verilen yorumda geçen TÜM ŞEHİRLERİ tespit eder.
 * Word-boundary kontrolü yapar ki "denizli" "deniz" gibi şeylerle karışmasın,
 * "ankara" "anka" gibi olmasın.
 *
 * Algoritma:
 * 1. Input'u ASCII-folded lowercase yap
 * 2. Aliases'i uzunluğa göre sırala (en uzun match öncelikli)
 * 3. Her alias için word-boundary regex ile ara
 * 4. Overlapping match'leri filtrele (uzun olan kazanır)
 */
export function detectCities(input: string): CityMatch[] {
  const normalized = normalizeAscii(input);
  const matches: CityMatch[] = [];

  for (const { alias, canonical } of SORTED_ALIASES) {
    // Word boundary: başında ve sonunda non-alphanumeric veya string boundary
    // Türkçe karakterler ASCII-fold edildiği için \b yeterli
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'g');
    let m: RegExpExecArray | null;
    while ((m = regex.exec(normalized)) !== null) {
      const start = m.index;
      const end = start + alias.length;
      // Overlap kontrolü: bu match daha önce bulunmuş daha uzun bir match
      // içinde mi? (Örnek: "kahramanmaras" eşleştiğinde "maras" görmezden gelinmeli)
      const overlaps = matches.some(
        (existing) =>
          (start >= existing.start && start < existing.end) ||
          (end > existing.start && end <= existing.end) ||
          (start <= existing.start && end >= existing.end),
      );
      if (!overlaps) {
        matches.push({ canonical, alias, start, end });
      }
    }
  }

  // Posizyona göre sırala (sonuçların okunabilirliği için)
  matches.sort((a, b) => a.start - b.start);
  return matches;
}

/**
 * Net tek şehir döndürür; yorumda birden fazla farklı il varsa null.
 * Aynı il'in birden fazla alias'ı tespit edilirse hala tek il sayılır.
 */
export function detectSingleCity(input: string): {
  city: string | null;
  allCities: string[];
  ambiguous: boolean;
} {
  const matches = detectCities(input);
  const unique = Array.from(new Set(matches.map((m) => m.canonical)));

  if (unique.length === 0) {
    return { city: null, allCities: [], ambiguous: false };
  }
  if (unique.length === 1) {
    return { city: unique[0]!, allCities: unique, ambiguous: false };
  }
  // Birden fazla il -> ambiguous, fiyat verme
  return { city: null, allCities: unique, ambiguous: true };
}
