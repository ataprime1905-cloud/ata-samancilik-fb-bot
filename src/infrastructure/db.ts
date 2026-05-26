// ============================================================
// Prisma client + helpers
// ============================================================

import { PrismaClient } from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';

let prismaInstance: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }
  return prismaInstance;
}

export async function disconnectPrisma(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

/**
 * Author platform ID'sini hash'ler.
 * KVKK pseudonymization. Ham ID veritabanında tutulmaz.
 *
 * Salt env'den okunur. Salt değişirse mevcut hash'ler kullanılamaz hale gelir
 * (intentional: re-identification harder).
 */
export function hashAuthorId(platformId: string, salt?: string): string {
  const actualSalt = salt || process.env.META_APP_SECRET || 'default-dev-salt';
  return createHmac('sha256', actualSalt).update(platformId).digest('hex');
}

/**
 * Payload hash (audit log için).
 */
export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
