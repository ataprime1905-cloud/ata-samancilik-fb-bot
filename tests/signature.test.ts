// ============================================================
// Signature Verification Tests
// ============================================================

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature, verifyChallenge } from '../src/infrastructure/meta/signature.js';

const APP_SECRET = 'test-app-secret-1234';

function makeSignature(body: string, secret: string): string {
  const digest = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${digest}`;
}

describe('verifyMetaSignature', () => {
  it('returns true for valid signature', () => {
    const body = JSON.stringify({ object: 'page', entry: [] });
    const sig = makeSignature(body, APP_SECRET);
    expect(
      verifyMetaSignature({ rawBody: body, signatureHeader: sig, appSecret: APP_SECRET }),
    ).toBe(true);
  });

  it('returns false for tampered body', () => {
    const body = JSON.stringify({ object: 'page', entry: [] });
    const sig = makeSignature(body, APP_SECRET);
    const tamperedBody = body + 'X';
    expect(
      verifyMetaSignature({ rawBody: tamperedBody, signatureHeader: sig, appSecret: APP_SECRET }),
    ).toBe(false);
  });

  it('returns false for wrong secret', () => {
    const body = '{"test":1}';
    const sig = makeSignature(body, 'wrong-secret');
    expect(
      verifyMetaSignature({ rawBody: body, signatureHeader: sig, appSecret: APP_SECRET }),
    ).toBe(false);
  });

  it('returns false when header missing', () => {
    expect(
      verifyMetaSignature({ rawBody: 'body', signatureHeader: undefined, appSecret: APP_SECRET }),
    ).toBe(false);
  });

  it('returns false when appSecret missing', () => {
    expect(
      verifyMetaSignature({ rawBody: 'body', signatureHeader: 'sha256=abc', appSecret: '' }),
    ).toBe(false);
  });

  it('returns false for header without sha256= prefix', () => {
    const body = 'test';
    expect(
      verifyMetaSignature({ rawBody: body, signatureHeader: 'md5=abc', appSecret: APP_SECRET }),
    ).toBe(false);
  });

  it('works with Buffer rawBody', () => {
    const body = Buffer.from('{"hello":"world"}');
    const sig = makeSignature(body.toString(), APP_SECRET);
    expect(
      verifyMetaSignature({ rawBody: body, signatureHeader: sig, appSecret: APP_SECRET }),
    ).toBe(true);
  });
});

describe('verifyChallenge', () => {
  const VERIFY_TOKEN = 'my-verify-token-1234';

  it('returns challenge for valid subscribe request', () => {
    const challenge = 'random_challenge_string';
    const result = verifyChallenge({
      mode: 'subscribe',
      token: VERIFY_TOKEN,
      challenge,
      expectedToken: VERIFY_TOKEN,
    });
    expect(result).toBe(challenge);
  });

  it('returns null for wrong mode', () => {
    const result = verifyChallenge({
      mode: 'unsubscribe',
      token: VERIFY_TOKEN,
      challenge: 'abc',
      expectedToken: VERIFY_TOKEN,
    });
    expect(result).toBeNull();
  });

  it('returns null for wrong token', () => {
    const result = verifyChallenge({
      mode: 'subscribe',
      token: 'wrong-token',
      challenge: 'abc',
      expectedToken: VERIFY_TOKEN,
    });
    expect(result).toBeNull();
  });

  it('returns null when challenge missing', () => {
    const result = verifyChallenge({
      mode: 'subscribe',
      token: VERIFY_TOKEN,
      challenge: undefined,
      expectedToken: VERIFY_TOKEN,
    });
    expect(result).toBeNull();
  });
});
