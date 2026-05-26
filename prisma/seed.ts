// ============================================================
// Seed Script
// ============================================================
// Notlar:
// - Idempotent: tekrar tekrar çalıştırılabilir (upsert).
// - Mevcut 12 Facebook yorumunu bozmadan ekleme yapar.
// - Fiyatlar TL/ton, nakliye dahil. Brifindeki resmi liste.
// ============================================================

import { PrismaClient } from '@prisma/client';
import { slugifyTurkish } from '../src/application/normalizer/text-normalizer.js';

const prisma = new PrismaClient();

// --- Brifindeki resmi il bazlı fiyat listesi (TL/ton, nakliye dahil) ---
const CITY_PRICES: Array<[string, number]> = [
  ['Adana', 7500],
  ['Adıyaman', 8500],
  ['Afyonkarahisar', 7500],
  ['Ağrı', 8500],
  ['Aksaray', 7500],
  ['Amasya', 8000],
  ['Ankara', 7500],
  ['Antalya', 7500],
  ['Ardahan', 8500],
  ['Artvin', 8500],
  ['Aydın', 7000],
  ['Balıkesir', 7500],
  ['Bartın', 8000],
  ['Batman', 8500],
  ['Bayburt', 8500],
  ['Bilecik', 7500],
  ['Bingöl', 8500],
  ['Bitlis', 8500],
  ['Bolu', 8000],
  ['Burdur', 7500],
  ['Bursa', 7500],
  ['Çanakkale', 7500],
  ['Çankırı', 7500],
  ['Çorum', 8000],
  ['Denizli', 7000],
  ['Diyarbakır', 8500],
  ['Düzce', 8000],
  ['Edirne', 7500],
  ['Elazığ', 8500],
  ['Erzincan', 8500],
  ['Erzurum', 8500],
  ['Eskişehir', 7500],
  ['Gaziantep', 8500],
  ['Giresun', 8000],
  ['Gümüşhane', 8500],
  ['Hakkari', 8500],
  ['Hatay', 7500],
  ['Iğdır', 8500],
  ['Isparta', 7500],
  ['İstanbul', 7500],
  ['İzmir', 7000],
  ['Kahramanmaraş', 8500],
  ['Karabük', 8000],
  ['Karaman', 7500],
  ['Kars', 8500],
  ['Kastamonu', 8000],
  ['Kayseri', 7500],
  ['Kırıkkale', 7500],
  ['Kırklareli', 7500],
  ['Kırşehir', 7500],
  ['Kilis', 8500],
  ['Kocaeli', 7500],
  ['Konya', 7500],
  ['Kütahya', 7000],
  ['Malatya', 8500],
  ['Manisa', 7000],
  ['Mardin', 8500],
  ['Mersin', 7500],
  ['Muğla', 7000],
  ['Muş', 8500],
  ['Nevşehir', 7500],
  ['Niğde', 7500],
  ['Ordu', 8000],
  ['Osmaniye', 7500],
  ['Rize', 8000],
  ['Sakarya', 7500],
  ['Samsun', 8000],
  ['Şanlıurfa', 8500],
  ['Siirt', 8500],
  ['Sinop', 8000],
  ['Sivas', 7500],
  ['Tekirdağ', 7500],
  ['Tokat', 8000],
  ['Trabzon', 8000],
  ['Tunceli', 8500],
  ['Uşak', 7000],
  ['Van', 8500],
  ['Yalova', 7500],
  ['Yozgat', 7500],
  ['Zonguldak', 8000],
];

// Reply rule trigger keywords (kural motorunda da var; burası sadece görünürlük için)
const REPLY_RULES = [
  {
    intent: 'ask_price_generic',
    triggerPatterns: ['fiyat', 'ne kadar', 'kaç para', 'kaç lira', 'bilgi', 'fiyat nedir', 'fiyat alabilir'],
    replyTemplate: 'Başkan hangi il için istemiştiniz?',
    requiresCity: false,
    requiresProduct: false,
    fixedPriceOnly: false,
    humanFallback: false,
  },
  {
    intent: 'ask_price_with_city',
    triggerPatterns: ['{city}', '{city} fiyat'],
    replyTemplate: '{city} teslim Dörtlü Kaba Yem fiyatımız ton bazlı nakliye dahil {price} TL başkan.',
    requiresCity: true,
    requiresProduct: true,
    fixedPriceOnly: true,
    humanFallback: false,
  },
  {
    intent: 'complain_expensive',
    triggerPatterns: ['çok pahalı', 'pahalı', 'bu ne fiyat'],
    replyTemplate: 'Başkan ürün normal saman değil, 4’lü karma rasyon 👍',
    requiresCity: false,
    requiresProduct: false,
    fixedPriceOnly: false,
    humanFallback: false,
  },
  {
    intent: 'ask_tonnage',
    triggerPatterns: ['kaç ton', 'tır kaç ton', 'sevkiyat kaç ton'],
    replyTemplate: 'Sevkiyatlarımız TIR bazlıdır başkan ortalama 25-26 ton gönderim sağlıyoruz.',
    requiresCity: false,
    requiresProduct: false,
    fixedPriceOnly: false,
    humanFallback: false,
  },
  {
    intent: 'ask_minimum_tonnage',
    triggerPatterns: ['minimum', 'az alabilir', '10 ton', 'olur mu'],
    replyTemplate: 'Başkan sevkiyatlarımız TIR bazlıdır, ortalama 25-26 ton gönderim sağlıyoruz.',
    requiresCity: false,
    requiresProduct: false,
    fixedPriceOnly: false,
    humanFallback: false,
  },
  {
    intent: 'ask_phone',
    triggerPatterns: ['numara', 'telefon', 'iletişim', 'arayın', 'nasıl ulaşırız'],
    replyTemplate: 'Mesaj bırakın başkan hemen dönüş sağlayalım 👍',
    requiresCity: false,
    requiresProduct: false,
    fixedPriceOnly: false,
    humanFallback: false,
  },
  {
    intent: 'bargain',
    triggerPatterns: ['son olur mu', 'indirim', 'düşer mi', 'pahalı biraz', 'en son ne olur'],
    replyTemplate: 'Başkan fiyatlarımız sabit, nakliye dahil ton bazlı veriyoruz.',
    requiresCity: false,
    requiresProduct: false,
    fixedPriceOnly: false,
    humanFallback: false,
  },
  {
    intent: 'ask_product_details',
    triggerPatterns: ['içerik', 'içinde ne', 'ne içeriyor', 'karışım'],
    replyTemplate:
      'Başkan %50 mısır silajı, %20 sorgum otu, %15 arpa posası ve %15 pancar posası 4’lü karma rasyon 👍',
    requiresCity: false,
    requiresProduct: false,
    fixedPriceOnly: false,
    humanFallback: false,
  },
  {
    intent: 'ask_other_product',
    triggerPatterns: ['yonca', 'arpa var mı', 'saman var mı', 'mısır silajı tek'],
    replyTemplate: 'Başkan hangi ürün için istemiştiniz?',
    requiresCity: false,
    requiresProduct: false,
    fixedPriceOnly: false,
    humanFallback: true,
  },
];

const EGE_CITIES = ['İzmir', 'Aydın', 'Manisa', 'Muğla', 'Denizli', 'Uşak', 'Kütahya', 'Afyonkarahisar'];

async function main() {
  console.log('🌱 Seed başlıyor...');

  // ---------- Product: Dörtlü Kaba Yem ----------
  const product = await prisma.product.upsert({
    where: { sku: 'dortlu-kaba-yem' },
    update: {
      name: 'Dörtlü Kaba Yem',
      isActive: true,
      shippingMode: 'tir',
      minTonnageDefault: 25,
      notes: 'TIR bazlı sevkiyat; Ege bölgesinde minimum 10 ton olabilir.',
    },
    create: {
      sku: 'dortlu-kaba-yem',
      name: 'Dörtlü Kaba Yem',
      isActive: true,
      unit: 'ton',
      shippingMode: 'tir',
      minTonnageDefault: 25,
      notes: 'TIR bazlı sevkiyat; Ege bölgesinde minimum 10 ton olabilir.',
    },
  });
  console.log(`✓ Product: ${product.name} (${product.id})`);

  // ---------- Product attributes ----------
  await prisma.productAttribute.upsert({
    where: { productId: product.id },
    update: {},
    create: {
      productId: product.id,
      compositionJson: {
        'Mısır Silajı': 50,
        'Sorgum Otu': 20,
        'Arpa Posası': 15,
        'Pancar Posası': 15,
      },
      protein: 10,
      dryMatter: 32,
      energyMin: 2400,
      energyMax: 2500,
      packWeightKg: 25,
      isVacuumPressed: true,
    },
  });
  console.log('✓ Product attributes');

  // ---------- City prices ----------
  let cityCount = 0;
  for (const [cityName, price] of CITY_PRICES) {
    const slug = slugifyTurkish(cityName);
    const minOverride = EGE_CITIES.includes(cityName) ? 10 : null;

    // Aynı (productId, citySlug, validFrom) kombinasyonu varsa update,
    // yoksa yeni kayıt. validFrom default now() olduğu için pratik olarak
    // her seed'de tek bir aktif fiyat satırı oluşur.
    const existing = await prisma.cityPrice.findFirst({
      where: { productId: product.id, citySlug: slug, isActive: true },
    });

    if (existing) {
      await prisma.cityPrice.update({
        where: { id: existing.id },
        data: {
          priceTryPerTon: price,
          minTonnageOverride: minOverride,
          transportIncluded: true,
          cityName,
        },
      });
    } else {
      await prisma.cityPrice.create({
        data: {
          productId: product.id,
          cityName,
          citySlug: slug,
          priceTryPerTon: price,
          transportIncluded: true,
          minTonnageOverride: minOverride,
          isActive: true,
        },
      });
    }
    cityCount++;
  }
  console.log(`✓ City prices: ${cityCount} il`);

  // ---------- Reply rules ----------
  for (const rule of REPLY_RULES) {
    await prisma.replyRule.upsert({
      where: { intent: rule.intent },
      update: {
        triggerPatternsJson: rule.triggerPatterns,
        replyTemplate: rule.replyTemplate,
        requiresCity: rule.requiresCity,
        requiresProduct: rule.requiresProduct,
        fixedPriceOnly: rule.fixedPriceOnly,
        humanFallback: rule.humanFallback,
        isActive: true,
      },
      create: {
        intent: rule.intent,
        triggerPatternsJson: rule.triggerPatterns,
        replyTemplate: rule.replyTemplate,
        requiresCity: rule.requiresCity,
        requiresProduct: rule.requiresProduct,
        fixedPriceOnly: rule.fixedPriceOnly,
        humanFallback: rule.humanFallback,
        isActive: true,
      },
    });
  }
  console.log(`✓ Reply rules: ${REPLY_RULES.length} kural`);

  // ---------- System settings (default automation mode) ----------
  await prisma.systemSetting.upsert({
    where: { key: 'automation_mode' },
    update: {},
    create: {
      key: 'automation_mode',
      valueJson: { mode: 'preview_only' },
    },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'default_product_sku' },
    update: { valueJson: { sku: 'dortlu-kaba-yem' } },
    create: {
      key: 'default_product_sku',
      valueJson: { sku: 'dortlu-kaba-yem' },
    },
  });
  console.log('✓ System settings');

  console.log('🎉 Seed tamamlandı.');
}

main()
  .catch((e) => {
    console.error('❌ Seed hatası:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
