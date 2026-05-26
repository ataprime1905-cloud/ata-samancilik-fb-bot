// ============================================================
// City Aliases
// ============================================================
// Her canonical il için, kullanıcıların yazma şekillerini eşler.
// Aliases sırası önemli: daha spesifik olanlar önce gelmeli
// ("kahramanmaraş" -> "Kahramanmaraş", "maraş" -> "Kahramanmaraş")
// Match algoritması word-boundary ile çalışacak.
// ============================================================

import { asciiFold, turkishLowerCase } from './text-normalizer.js';

export interface CityAlias {
  canonical: string; // "Şanlıurfa"
  // Match için kullanılan ASCII-folded alias'lar
  // Sırası önemli değil (algoritma en uzun match'i alır)
  aliases: string[];
}

// Tüm 81 il + sık kullanılan alias'lar
// Aliases ASCII-folded ve lowercase tutulur (matching için)
export const CITY_ALIASES: CityAlias[] = [
  { canonical: 'Adana', aliases: ['adana'] },
  { canonical: 'Adıyaman', aliases: ['adiyaman', 'adıyaman'] },
  { canonical: 'Afyonkarahisar', aliases: ['afyonkarahisar', 'afyon'] },
  { canonical: 'Ağrı', aliases: ['agri', 'ağrı'] },
  { canonical: 'Aksaray', aliases: ['aksaray'] },
  { canonical: 'Amasya', aliases: ['amasya'] },
  { canonical: 'Ankara', aliases: ['ankara'] },
  { canonical: 'Antalya', aliases: ['antalya'] },
  { canonical: 'Ardahan', aliases: ['ardahan'] },
  { canonical: 'Artvin', aliases: ['artvin'] },
  { canonical: 'Aydın', aliases: ['aydin', 'aydın'] },
  { canonical: 'Balıkesir', aliases: ['balikesir', 'balıkesir'] },
  { canonical: 'Bartın', aliases: ['bartin', 'bartın'] },
  { canonical: 'Batman', aliases: ['batman'] },
  { canonical: 'Bayburt', aliases: ['bayburt'] },
  { canonical: 'Bilecik', aliases: ['bilecik'] },
  { canonical: 'Bingöl', aliases: ['bingol', 'bingöl'] },
  { canonical: 'Bitlis', aliases: ['bitlis'] },
  { canonical: 'Bolu', aliases: ['bolu'] },
  { canonical: 'Burdur', aliases: ['burdur'] },
  { canonical: 'Bursa', aliases: ['bursa'] },
  { canonical: 'Çanakkale', aliases: ['canakkale', 'çanakkale'] },
  { canonical: 'Çankırı', aliases: ['cankiri', 'çankırı'] },
  { canonical: 'Çorum', aliases: ['corum', 'çorum'] },
  { canonical: 'Denizli', aliases: ['denizli'] },
  { canonical: 'Diyarbakır', aliases: ['diyarbakir', 'diyarbakır'] },
  { canonical: 'Düzce', aliases: ['duzce', 'düzce'] },
  { canonical: 'Edirne', aliases: ['edirne'] },
  { canonical: 'Elazığ', aliases: ['elazig', 'elazığ'] },
  { canonical: 'Erzincan', aliases: ['erzincan'] },
  { canonical: 'Erzurum', aliases: ['erzurum'] },
  { canonical: 'Eskişehir', aliases: ['eskisehir', 'eskişehir'] },
  { canonical: 'Gaziantep', aliases: ['gaziantep', 'antep', 'g.antep'] },
  { canonical: 'Giresun', aliases: ['giresun'] },
  { canonical: 'Gümüşhane', aliases: ['gumushane', 'gümüşhane'] },
  { canonical: 'Hakkari', aliases: ['hakkari', 'hakkâri'] },
  { canonical: 'Hatay', aliases: ['hatay'] },
  { canonical: 'Iğdır', aliases: ['igdir', 'iğdır'] },
  { canonical: 'Isparta', aliases: ['isparta'] },
  { canonical: 'İstanbul', aliases: ['istanbul', 'ıstanbul', 'i̇stanbul'] },
  { canonical: 'İzmir', aliases: ['izmir', 'ızmir', 'i̇zmir'] },
  { canonical: 'Kahramanmaraş', aliases: ['kahramanmaras', 'kahramanmaraş', 'maras', 'maraş', 'k.maras', 'k.maraş'] },
  { canonical: 'Karabük', aliases: ['karabuk', 'karabük'] },
  { canonical: 'Karaman', aliases: ['karaman'] },
  { canonical: 'Kars', aliases: ['kars'] },
  { canonical: 'Kastamonu', aliases: ['kastamonu'] },
  { canonical: 'Kayseri', aliases: ['kayseri'] },
  { canonical: 'Kırıkkale', aliases: ['kirikkale', 'kırıkkale'] },
  { canonical: 'Kırklareli', aliases: ['kirklareli', 'kırklareli'] },
  { canonical: 'Kırşehir', aliases: ['kirsehir', 'kırşehir'] },
  { canonical: 'Kilis', aliases: ['kilis'] },
  { canonical: 'Kocaeli', aliases: ['kocaeli', 'izmit'] },
  { canonical: 'Konya', aliases: ['konya'] },
  { canonical: 'Kütahya', aliases: ['kutahya', 'kütahya'] },
  { canonical: 'Malatya', aliases: ['malatya'] },
  { canonical: 'Manisa', aliases: ['manisa'] },
  { canonical: 'Mardin', aliases: ['mardin'] },
  { canonical: 'Mersin', aliases: ['mersin', 'içel'] },
  { canonical: 'Muğla', aliases: ['mugla', 'muğla'] },
  { canonical: 'Muş', aliases: ['mus', 'muş'] },
  { canonical: 'Nevşehir', aliases: ['nevsehir', 'nevşehir'] },
  { canonical: 'Niğde', aliases: ['nigde', 'niğde'] },
  { canonical: 'Ordu', aliases: ['ordu'] },
  { canonical: 'Osmaniye', aliases: ['osmaniye'] },
  { canonical: 'Rize', aliases: ['rize'] },
  { canonical: 'Sakarya', aliases: ['sakarya', 'adapazari', 'adapazarı'] },
  { canonical: 'Samsun', aliases: ['samsun'] },
  { canonical: 'Şanlıurfa', aliases: ['sanliurfa', 'şanlıurfa', 'urfa'] },
  { canonical: 'Siirt', aliases: ['siirt'] },
  { canonical: 'Şırnak', aliases: ['sirnak', 'şırnak'] },
  { canonical: 'Sinop', aliases: ['sinop'] },
  { canonical: 'Sivas', aliases: ['sivas'] },
  { canonical: 'Tekirdağ', aliases: ['tekirdag', 'tekirdağ'] },
  { canonical: 'Tokat', aliases: ['tokat'] },
  { canonical: 'Trabzon', aliases: ['trabzon'] },
  { canonical: 'Tunceli', aliases: ['tunceli', 'dersim'] },
  { canonical: 'Uşak', aliases: ['usak', 'uşak'] },
  { canonical: 'Van', aliases: ['van'] },
  { canonical: 'Yalova', aliases: ['yalova'] },
  { canonical: 'Yozgat', aliases: ['yozgat'] },
  { canonical: 'Zonguldak', aliases: ['zonguldak'] },
];

/**
 * Build a flat lookup: ASCII-folded alias -> canonical name
 * Algoritma normalize input içinde aliases'i word-boundary ile ararken kullanır.
 */
export function buildCityLookup(): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const entry of CITY_ALIASES) {
    for (const alias of entry.aliases) {
      const folded = asciiFold(turkishLowerCase(alias));
      lookup.set(folded, entry.canonical);
    }
  }
  return lookup;
}

/**
 * Canonical city name list — match algoritması için en uzun alias'tan başlar.
 */
export function getAllAliasesSortedByLength(): Array<{ alias: string; canonical: string }> {
  const all: Array<{ alias: string; canonical: string }> = [];
  for (const entry of CITY_ALIASES) {
    for (const alias of entry.aliases) {
      const folded = asciiFold(turkishLowerCase(alias));
      all.push({ alias: folded, canonical: entry.canonical });
    }
  }
  // En uzun match'i öncelikle (kahramanmaras > maras gibi durumlarda kritik)
  all.sort((a, b) => b.alias.length - a.alias.length);
  return all;
}
