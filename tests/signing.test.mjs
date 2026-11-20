// Signing must match K3 exactly, because a mismatch shows up only as a 401 in
// production. We verify our own signature with the public key, and we verify the
// pre-sign text construction against the documented example.

import { suite, test, assert, eq } from './harness.mjs';
import {
  generateKeyPair,
  loadPrivateKey,
  signText,
  presignText,
  authHeaders,
  wsHandshakeHeaders,
  verifySignature
} from '../app/lib/signing.mjs';

suite('signing — K3 contract', () => {
  test('pre-sign text is timestamp + METHOD + path, no query string', () => {
    eq(presignText(1700000000000, 'GET', '/trade-api/v2/portfolio/balance'), '1700000000000GET/trade-api/v2/portfolio/balance');
  });

  test('query parameters are stripped before signing', () => {
    eq(
      presignText(1700000000000, 'get', '/trade-api/v2/portfolio/orders?limit=5'),
      '1700000000000GET/trade-api/v2/portfolio/orders'
    );
  });

  test('method is upper-cased', () => {
    assert(presignText(1, 'post', '/x').includes('POST'));
  });

  test('ed25519 signatures verify and are 64 raw bytes (88 base64 chars)', () => {
    const kp = generateKeyPair('ed25519');
    const key = loadPrivateKey(kp.privatePem);
    eq(key.type, 'ed25519');
    const text = presignText(1700000000000, 'GET', '/trade-api/v2/markets');
    const sig = signText(key, text);
    eq(Buffer.from(sig, 'base64').length, 64, 'ed25519 signature length');
    assert(verifySignature(kp.publicPem, text, sig, 'ed25519'), 'signature verifies');
    assert(!verifySignature(kp.publicPem, `${text}x`, sig, 'ed25519'), 'tampered text fails');
  });

  test('rsa-pss/sha256 signatures verify with the documented padding', () => {
    const kp = generateKeyPair('rsa');
    const key = loadPrivateKey(kp.privatePem);
    eq(key.type, 'rsa');
    const text = presignText(1700000000000, 'POST', '/trade-api/v2/portfolio/events/orders');
    const sig = signText(key, text);
    eq(Buffer.from(sig, 'base64').length, 256, 'rsa-2048 signature length');
    assert(verifySignature(kp.publicPem, text, sig, 'rsa'), 'signature verifies');
    assert(!verifySignature(kp.publicPem, `${text}x`, sig, 'rsa'), 'tampered text fails');
  });

  test('auth headers carry exactly the three documented names', () => {
    const kp = generateKeyPair('ed25519');
    const key = loadPrivateKey(kp.privatePem);
    const h = authHeaders(key, 'my-key-id', 'GET', '/trade-api/v2/portfolio/balance', 1700000000000);
    eq(h['KALSHI-ACCESS-KEY'], 'my-key-id');
    eq(h['KALSHI-ACCESS-TIMESTAMP'], '1700000000000');
    assert(typeof h['KALSHI-ACCESS-SIGNATURE'] === 'string' && h['KALSHI-ACCESS-SIGNATURE'].length > 40);
  });

  test('WebSocket handshake signs GET /trade-api/ws/v2 (K8)', () => {
    const kp = generateKeyPair('ed25519');
    const key = loadPrivateKey(kp.privatePem);
    const h = wsHandshakeHeaders(key, 'kid', 1700000000000);
    const expectedText = '1700000000000GET/trade-api/ws/v2';
    assert(verifySignature(kp.publicPem, expectedText, h['KALSHI-ACCESS-SIGNATURE'], 'ed25519'), 'WS pre-sign text');
  });

  test('an unsupported key type is rejected loudly', () => {
    let threw = false;
    try {
      loadPrivateKey('-----BEGIN PRIVATE KEY-----\nbm9wZQ==\n-----END PRIVATE KEY-----');
    } catch {
      threw = true;
    }
    assert(threw, 'garbage PEM must throw, not silently produce a bad signature');
  });
});
