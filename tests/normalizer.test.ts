// ============================================================
// Normalizer Tests
// ============================================================
// Türkçe karakter handling en kritik nokta:
// Yanlış normalize = yanlış il eşleşmesi = yanlış fiyat veya miss.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  turkishLowerCase,
  asciiFold,
  normalizeForMatching,
  normalizeAscii,
  isEmptyOrGarbage,
  slugifyTurkish,
  containsTurkishPhone,
  formatPriceTr,
  stripEmoji,
} from '../src/application/normalizer/text-normalizer.js';
import {
  detectCities,
  detectSingleCity,
} from '../src/application/normalizer/city-normalizer.js';

// ============================================================
// turkishLowerCase
// ============================================================
describe('turkishLowerCase', () => {
  it('converts İ to i (dotted I)', () => {
    expect(turkishLowerCase('İSTANBUL')).toBe('istanbul');
  });

  it('converts I to ı (dotless I)', () => {
    expect(turkishLowerCase('IĞDIR')).toBe('ığdır');
  });

  it('leaves already lowercase text unchanged', () => {
    expect(turkishLowerCase('ankara')).toBe('ankara');
  });

  it('handles mixed case with all Türkçe chars', () => {
    expect(turkishLowerCase('ŞANLIURfa')).toBe('şanlıurfa');
  });

  it('handles Ğ Ü Ö Ş Ç normally', () => {
    expect(turkishLowerCase('ŞÇÖÜĞ')).toBe('şçöüğ');
  });
});

// ============================================================
// asciiFold
// ============================================================
describe('asciiFold', () => {
  it('folds ş -> s, ç -> c, ğ -> g, ı -> i, ü -> u, ö -> o', () => {
    expect(asciiFold('şanlıurfa')).toBe('sanliurfa');
    expect(asciiFold('çorum')).toBe('corum');
    expect(asciiFold('afyonkarahisar')).toBe('afyonkarahisar');
  });

  it('folds uppercase variants', () => {
    expect(asciiFold('Ş')).toBe('S');
    expect(asciiFold('Ğ')).toBe('G');
  });
});

// ============================================================
// isEmptyOrGarbage
// ============================================================
describe('isEmptyOrGarbage', () => {
  it('returns true for all dots', () => {
    expect(isEmptyOrGarbage('.....')).toBe(true);
  });

  it('returns true for all punctuation', () => {
    expect(isEmptyOrGarbage('?!.,')).toBe(true);
  });

  it('returns true for single emoji', () => {
    expect(isEmptyOrGarbage('👍')).toBe(true);
  });

  it('returns true for empty string', () => {
    expect(isEmptyOrGarbage('')).toBe(true);
  });

  it('returns true for whitespace only', () => {
    expect(isEmptyOrGarbage('   ')).toBe(true);
  });

  it('returns false for real comment', () => {
    expect(isEmptyOrGarbage('fiyat nedir')).toBe(false);
  });

  it('returns false for single city name', () => {
    expect(isEmptyOrGarbage('Samsun')).toBe(false);
  });

  it('returns false for two letter word', () => {
    expect(isEmptyOrGarbage('ok')).toBe(false);
  });
});

// ============================================================
// formatPriceTr
// ============================================================
describe('formatPriceTr', () => {
  it('formats 7500 as 7.500', () => {
    expect(formatPriceTr(7500)).toBe('7.500');
  });

  it('formats 8000 as 8.000', () => {
    expect(formatPriceTr(8000)).toBe('8.000');
  });

  it('formats 8500 as 8.500', () => {
    expect(formatPriceTr(8500)).toBe('8.500');
  });

  it('formats 7000 as 7.000', () => {
    expect(formatPriceTr(7000)).toBe('7.000');
  });
});

// ============================================================
// slugifyTurkish
// ============================================================
describe('slugifyTurkish', () => {
  it('converts Şanlıurfa -> sanliurfa', () => {
    expect(slugifyTurkish('Şanlıurfa')).toBe('sanliurfa');
  });

  it('converts Afyonkarahisar -> afyonkarahisar', () => {
    expect(slugifyTurkish('Afyonkarahisar')).toBe('afyonkarahisar');
  });

  it('converts Kahramanmaraş -> kahramanmaras', () => {
    expect(slugifyTurkish('Kahramanmaraş')).toBe('kahramanmaras');
  });

  it('converts İzmir -> izmir', () => {
    expect(slugifyTurkish('İzmir')).toBe('izmir');
  });
});

// ============================================================
// containsTurkishPhone
// ============================================================
describe('containsTurkishPhone', () => {
  it('detects 5xx formatted number', () => {
    expect(containsTurkishPhone('0532 123 45 67')).toBe(true);
  });

  it('detects +90 prefix number', () => {
    expect(containsTurkishPhone('+90 535 123 4567')).toBe(true);
  });

  it('does not false-positive on short numbers', () => {
    expect(containsTurkishPhone('1234')).toBe(false);
  });

  it('does not false-positive on city in text', () => {
    expect(containsTurkishPhone('Ankara fiyat nedir')).toBe(false);
  });
});

// ============================================================
// detectCities
// ============================================================
describe('detectCities', () => {
  it('detects single city "ankara"', () => {
    const result = detectCities('ankara fiyat nedir');
    expect(result.map((m) => m.canonical)).toContain('Ankara');
  });

  it('detects "samsun" in sentence', () => {
    const result = detectCities('samsun için ne kadar');
    expect(result.map((m) => m.canonical)).toContain('Samsun');
  });

  it('resolves alias "urfa" -> Şanlıurfa', () => {
    const result = detectCities('urfa fiyat');
    expect(result.map((m) => m.canonical)).toContain('Şanlıurfa');
  });

  it('resolves alias "antep" -> Gaziantep', () => {
    const result = detectCities('antep için fiyat');
    expect(result.map((m) => m.canonical)).toContain('Gaziantep');
  });

  it('resolves alias "maraş" -> Kahramanmaraş WITHOUT duplicating "kahramanmaraş"', () => {
    const result = detectCities('kahramanmaraş fiyat');
    const canonicals = result.map((m) => m.canonical);
    expect(canonicals).toContain('Kahramanmaraş');
    // "maraş" overlap: kahramanmaraş içinde maraş bulunmamalı
    expect(canonicals.filter((c) => c === 'Kahramanmaraş')).toHaveLength(1);
  });

  it('does NOT match "anka" when word is "ankara" (no false positive partial)', () => {
    const result = detectCities('anka');
    // anka is not a city alias
    expect(result).toHaveLength(0);
  });

  it('does NOT match city inside a different word', () => {
    // "Deniz" in "denizci" — deniz is not a city, but ensure denizli doesn't match in "denizli" sub-string
    const result = detectCities('denizli mağazası');
    const canonicals = result.map((m) => m.canonical);
    // denizli is a city and should match as full word
    expect(canonicals).toContain('Denizli');
  });

  it('detects two different cities (multiple)', () => {
    const result = detectCities('ankara ve samsun için fiyat');
    const canonicals = result.map((m) => m.canonical);
    expect(canonicals).toContain('Ankara');
    expect(canonicals).toContain('Samsun');
  });
});

// ============================================================
// detectSingleCity
// ============================================================
describe('detectSingleCity', () => {
  it('returns single city for "konya"', () => {
    const result = detectSingleCity('konya için fiyat');
    expect(result.city).toBe('Konya');
    expect(result.ambiguous).toBe(false);
  });

  it('returns null and ambiguous=true for two cities', () => {
    const result = detectSingleCity('ankara ve samsun fiyat');
    expect(result.city).toBeNull();
    expect(result.ambiguous).toBe(true);
    expect(result.allCities).toContain('Ankara');
    expect(result.allCities).toContain('Samsun');
  });

  it('returns null city for no match', () => {
    const result = detectSingleCity('fiyat nedir');
    expect(result.city).toBeNull();
    expect(result.ambiguous).toBe(false);
  });

  it('handles "k.maraş" alias -> Kahramanmaraş', () => {
    const result = detectSingleCity('k.maraş fiyat');
    expect(result.city).toBe('Kahramanmaraş');
  });

  it('handles "afyon" alias -> Afyonkarahisar', () => {
    const result = detectSingleCity('afyon ne kadar');
    expect(result.city).toBe('Afyonkarahisar');
  });
});

// ============================================================
// stripEmoji
// ============================================================
describe('stripEmoji', () => {
  it('removes emoji from text', () => {
    const text = 'merhaba 👍 fiyat';
    const result = stripEmoji(text);
    expect(result).not.toContain('👍');
    expect(result).toContain('fiyat');
  });
});
