// ============================================================
// Conversation Context Service
// ============================================================
// Kısa süreli kullanıcı state'i (24 saat TTL default).
// - "fiyat" -> sonra "samsun" akışı için bağlam taşır.
// - State otomatik expire olur; sonsuz saklanmaz (KVKK).
// ============================================================

import { getPrisma } from '../../infrastructure/db.js';
import type { ConversationContext } from '../../domain/types.js';
import type { Intent } from '../../config/constants.js';
import { loadEnv } from '../../config/env.js';

export async function loadContext(
  platform: string,
  authorHash: string,
): Promise<ConversationContext | null> {
  const prisma = getPrisma();
  const row = await prisma.conversationState.findUnique({
    where: { platform_authorPlatformIdHash: { platform, authorPlatformIdHash: authorHash } },
  });
  if (!row) return null;

  // Expire kontrolü
  if (row.stateExpiresAt < new Date()) {
    // Sessizce expired olarak kabul et; cleanup job ayrıca silebilir
    return null;
  }

  return {
    lastCity: row.lastCity,
    lastProductSku: row.lastProductId, // schema'da last_product_id; sku'yu burada saklıyoruz
    lastIntent: (row.lastIntent as Intent | null) ?? null,
    expiresAt: row.stateExpiresAt,
  };
}

export async function saveContext(
  platform: string,
  authorHash: string,
  ctx: ConversationContext,
): Promise<void> {
  const prisma = getPrisma();
  const env = loadEnv();
  const expiresAt = new Date(Date.now() + env.CONVERSATION_STATE_TTL_HOURS * 60 * 60 * 1000);

  await prisma.conversationState.upsert({
    where: { platform_authorPlatformIdHash: { platform, authorPlatformIdHash: authorHash } },
    create: {
      platform,
      authorPlatformIdHash: authorHash,
      lastCity: ctx.lastCity,
      lastProductId: ctx.lastProductSku,
      lastIntent: ctx.lastIntent,
      stateExpiresAt: expiresAt,
    },
    update: {
      lastCity: ctx.lastCity,
      lastProductId: ctx.lastProductSku,
      lastIntent: ctx.lastIntent,
      stateExpiresAt: expiresAt,
    },
  });
}

/**
 * Expired state kayıtlarını siler. Scheduled job ile günlük çalıştırılır.
 */
export async function purgeExpiredContexts(): Promise<number> {
  const prisma = getPrisma();
  const result = await prisma.conversationState.deleteMany({
    where: { stateExpiresAt: { lt: new Date() } },
  });
  return result.count;
}
