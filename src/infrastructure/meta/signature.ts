// ============================================================
// Meta Webhook Signature Verification
// ============================================================
// Meta her webhook POST'unda X-Hub-Signature-256 header'ı gönderir.
// Format: "sha256=<hex_digest>"
// HMAC-SHA256(appSecret, raw_body)
//
// Bu KESİNLİKLE doğrulanmalı; aksi halde herkes webhook endpoint'ine
// fake event gönderebilir (yorum uydurabilir, sistemi tetikleyebilir).
// ============================================================

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface VerifySignatureInput {
  rawBody: string | Buffer;
  signatureHeader: string | undefined;
  appSecret: string;
}

export function verifyMetaSignature(input: VerifySignatureInput): boolean {
  if (!input.signatureHeader || !input.appSecret) return false;
  if (!input.signatureHeader.startsWith('sha256=')) return false;

  const providedDigest = input.signatureHeader.slice('sha256='.length);
  const expected = createHmac('sha256', input.appSecret)
    .update(input.rawBody)
    .digest('hex');

  // Timing-safe compare
  if (providedDigest.length !== expected.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(providedDigest, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  } catch {
    return false;
  }
}

/**
 * Webhook GET verification (subscribe akışı).
 * Meta endpoint'i ilk subscribe ederken `hub.challenge` ile doğrular.
 */
export interface VerifyChallengeInput {
  mode: string | undefined;
  token: string | undefined;
  challenge: string | undefined;
  expectedToken: string;
}

export function verifyChallenge(input: VerifyChallengeInput): string | null {
  if (input.mode === 'subscribe' && input.token === input.expectedToken && input.challenge) {
    return input.challenge;
  }
  return null;
}
