// ============================================================
// Price Service
// ============================================================
// DB üzerinden il bazlı fiyat lookup'ı.
// - Sadece aktif (is_active=true) ve geçerli tarihli kayıtlar döner
// - city_slug üzerinden arar (TR karakterlerden bağımsız)
// - Hiçbir zaman fiyat UYDURMAZ; bulamazsa null döner
//   (rule engine bunu human_review'a yönlendirir)
// ============================================================

import { getPrisma } from '../../infrastructure/db.js';
import type { PriceLookup } from '../../domain/types.js';
import { slugifyTurkish } from '../normalizer/text-normalizer.js';
import { DEFAULT_PRODUCT_SKU } from '../../config/constants.js';

/**
 * Verilen canonical şehir adı için aktif fiyatı getirir.
 * Brifindeki kural: listede olmayan il için fiyat verilmez.
 */
export async function resolvePriceByCity(
  cityName: string,
  productSku: string = DEFAULT_PRODUCT_SKU,
): Promise<PriceLookup | null> {
  const prisma = getPrisma();
  const citySlug = slugifyTurkish(cityName);
  const now = new Date();

  const row = await prisma.cityPrice.findFirst({
    where: {
      citySlug,
      isActive: true,
      product: { sku: productSku, isActive: true },
      validFrom: { lte: now },
      OR: [{ validTo: null }, { validTo: { gt: now } }],
    },
    include: { product: true },
    orderBy: { validFrom: 'desc' },
  });

  if (!row) return null;

  return {
    cityName: row.cityName,
    citySlug: row.citySlug,
    priceTryPerTon: row.priceTryPerTon,
    transportIncluded: row.transportIncluded,
    minTonnageOverride: row.minTonnageOverride,
    productName: row.product.name,
    productSku: row.product.sku,
  };
}

/**
 * Tüm il fiyatlarını listele (admin endpoint için).
 */
export async function listAllPrices(productSku: string = DEFAULT_PRODUCT_SKU): Promise<
  Array<{
    id: string;
    cityName: string;
    priceTryPerTon: number;
    transportIncluded: boolean;
    minTonnageOverride: number | null;
    isActive: boolean;
  }>
> {
  const prisma = getPrisma();
  const rows = await prisma.cityPrice.findMany({
    where: { product: { sku: productSku } },
    orderBy: { cityName: 'asc' },
  });
  type Row = (typeof rows)[0];
  return rows.map((r: Row) => ({
    id: r.id,
    cityName: r.cityName,
    priceTryPerTon: r.priceTryPerTon,
    transportIncluded: r.transportIncluded,
    minTonnageOverride: r.minTonnageOverride,
    isActive: r.isActive,
  }));
}

/**
 * Tek bir il fiyatını güncelle (admin endpoint için).
 * Yeni bir CityPrice satırı eklemek yerine in-place update yapıyoruz;
 * tarih bazlı versiyonlama FAZ 2 işi.
 */
export async function updatePriceById(
  id: string,
  patch: { priceTryPerTon?: number; isActive?: boolean; minTonnageOverride?: number | null },
): Promise<void> {
  const prisma = getPrisma();
  await prisma.cityPrice.update({
    where: { id },
    data: {
      ...(patch.priceTryPerTon !== undefined ? { priceTryPerTon: patch.priceTryPerTon } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      ...(patch.minTonnageOverride !== undefined ? { minTonnageOverride: patch.minTonnageOverride } : {}),
    },
  });
}
