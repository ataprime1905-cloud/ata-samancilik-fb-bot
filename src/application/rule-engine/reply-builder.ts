// ============================================================
// Reply Builder
// ============================================================
// Brifindeki tam cevap şablonları. Fiyat formatı TR binlik ayırıcı.
// Template'ler kod içinde sabit — DB'deki replyTemplate kayıtları
// override/audit için var; üretimde kod öncelikli (deterministik).
// ============================================================

import { INTENTS, type Intent, EGE_CITIES, DEFAULT_PRODUCT_NAME } from '../../config/constants.js';
import type { PriceLookup } from '../../domain/types.js';
import { formatPriceTr } from '../normalizer/text-normalizer.js';

export interface BuildReplyInput {
  intent: Intent;
  modifiers: Intent[];
  city: string | null;
  priceLookup: PriceLookup | null;
}

export interface BuildReplyResult {
  text: string | null;
  // İsteğe bağlı: cevap kullanıcıya gönderilmesin, sadece human review için
  needsHuman: boolean;
  humanReason: string | null;
}

/**
 * Verilen intent ve bağlam için cevap metni üretir.
 * null döndüğü durumda otomatik cevap gönderilmemeli.
 */
export function buildReply(input: BuildReplyInput): BuildReplyResult {
  const { intent, modifiers, city, priceLookup } = input;
  const hasBargainModifier = modifiers.includes(INTENTS.BARGAIN);

  switch (intent) {
    case INTENTS.ASK_PRICE_GENERIC:
      return {
        text: 'Başkan hangi il için istemiştiniz?',
        needsHuman: false,
        humanReason: null,
      };

    case INTENTS.ASK_PRICE_WITH_CITY:
    case INTENTS.PROVIDE_CITY: {
      if (!city || !priceLookup) {
        // İl tespit edildi ama DB'de yok -> human review
        return {
          text: 'Başkan bu il için fiyatı netleştirip dönüş sağlayalım.',
          needsHuman: true,
          humanReason: 'unknown_city',
        };
      }
      const formattedPrice = formatPriceTr(priceLookup.priceTryPerTon);
      let text = `${priceLookup.cityName} teslim ${priceLookup.productName} fiyatımız ton bazlı nakliye dahil ${formattedPrice} TL başkan.`;
      // Bargain modifier varsa: fiyat ver + sabit fiyat ekle
      if (hasBargainModifier) {
        text += ' Fiyatlarımız sabit başkan.';
      }
      return { text, needsHuman: false, humanReason: null };
    }

    case INTENTS.COMPLAIN_EXPENSIVE:
      return {
        text: 'Başkan ürün normal saman değil, 4’lü karma rasyon 👍',
        needsHuman: false,
        humanReason: null,
      };

    case INTENTS.ASK_TONNAGE:
      return {
        text: 'Sevkiyatlarımız TIR bazlıdır başkan ortalama 25-26 ton gönderim sağlıyoruz.',
        needsHuman: false,
        humanReason: null,
      };

    case INTENTS.ASK_MINIMUM_TONNAGE: {
      // Brifindeki kural 7:
      // - İl Ege bölgesindeyse: "Ege bölgesinde minimum 10 ton olabilir..."
      // - İl varsa Ege değilse: "Sevkiyatlarımız TIR bazlıdır..."
      // - İl yoksa: "Hangi il için istemiştiniz?"
      if (!city) {
        return {
          text: 'Başkan hangi il için istemiştiniz?',
          needsHuman: false,
          humanReason: null,
        };
      }
      if (EGE_CITIES.has(city)) {
        return {
          text: 'Başkan Ege bölgesinde minimum 10 ton olabilir, diğer bölgelerde sevkiyat TIR bazlıdır.',
          needsHuman: false,
          humanReason: null,
        };
      }
      return {
        text: 'Başkan sevkiyatlarımız TIR bazlıdır, ortalama 25-26 ton gönderim sağlıyoruz.',
        needsHuman: false,
        humanReason: null,
      };
    }

    case INTENTS.ASK_PHONE:
      return {
        text: 'Mesaj bırakın başkan hemen dönüş sağlayalım 👍',
        needsHuman: false,
        humanReason: null,
      };

    case INTENTS.BARGAIN:
      return {
        text: 'Başkan fiyatlarımız sabit, nakliye dahil ton bazlı veriyoruz.',
        needsHuman: false,
        humanReason: null,
      };

    case INTENTS.ASK_PRODUCT_DETAILS:
      return {
        text: 'Başkan %50 mısır silajı, %20 sorgum otu, %15 arpa posası ve %15 pancar posası 4’lü karma rasyon 👍',
        needsHuman: false,
        humanReason: null,
      };

    case INTENTS.ASK_SHIPPING:
      return {
        text: 'Sevkiyatlarımız TIR bazlıdır başkan ortalama 25-26 ton gönderim sağlıyoruz, nakliye dahil.',
        needsHuman: false,
        humanReason: null,
      };

    case INTENTS.ASK_OTHER_PRODUCT:
      // Katalog dışı ürün — kısa netleştirme sor, fakat human review aktif
      return {
        text: 'Başkan hangi ürün için istemiştiniz?',
        needsHuman: true,
        humanReason: 'unknown_product',
      };

    case INTENTS.SPAM_OR_ABUSE:
      return {
        text: null,
        needsHuman: true,
        humanReason: 'spam_or_abuse',
      };

    case INTENTS.OFF_TOPIC:
      return {
        text: null,
        needsHuman: true,
        humanReason: 'off_topic',
      };

    case INTENTS.UNKNOWN:
    default:
      return {
        text: null,
        needsHuman: true,
        humanReason: 'unclear_intent',
      };
  }
}

// Yardımcı: default product name'i export et (test/log için)
export const DEFAULT_PRODUCT = DEFAULT_PRODUCT_NAME;
