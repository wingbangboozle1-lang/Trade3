// Kalshi request signing. Source K3 + K1 + K8.
//
// K3 (https://docs.kalshi.com/getting_started/api_keys.md):
//   "The signature is the base64 encoding of the signed concatenation of the
//    timestamp, the HTTP method and the path."
//   "When signing requests, use the path without query parameters."
//   RSA : RSA-PSS with SHA-256, MGF1 with SHA-256, salt length = digest length.
//   Ed25519: "sign the message itself" (RFC 8032, 64-byte signature).
//   Timestamp must be within 30 seconds of Kalshi's clock.
// K8 (WebSocket): pre-sign text is timestamp + "GET" + "/trade-api/ws/v2".
//
// We sign on the server so the private key never reaches a browser.

import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Load a PEM private key. Accepts PKCS#8 ("BEGIN PRIVATE KEY") and PKCS#1
 * ("BEGIN RSA PRIVATE KEY"). Kalshi's docs note the PEM header does NOT identify
 * the algorithm, so always inspect the parsed object (K3).
 */
export function loadPrivateKey(pem) {
  const key = crypto.createPrivateKey({ key: pem, format: 'pem' });
  const type = key.asymmetricKeyType;
  if (type !== 'rsa' && type !== 'ed25519') {
    throw new Error(`Unsupported key type "${type}": Kalshi supports RSA-2048 (RSA-PSS) and Ed25519 (K3)`);
  }
  return { key, type };
}

export function loadPrivateKeyFromFile(path) {
  const pem = fs.readFileSync(path, 'utf8');
  return loadPrivateKey(pem);
}

export function loadPrivateKeyFromEnv(env = process.env) {
  const inline = env.KALSHI_PRIVATE_KEY_PEM || env.KALSHI_PRIVATE_KEY;
  if (inline && inline.includes('BEGIN')) return loadPrivateKey(inline);
  const file = env.KALSHI_PRIVATE_KEY_PATH;
  if (file && fs.existsSync(file)) return loadPrivateKeyFromFile(file);
  return null;
}

/** Sign a pre-sign text, returning base64. */
export function signText({ key, type }, text) {
  const message = Buffer.from(text, 'utf8');
  if (type === 'ed25519') {
    return crypto.sign(null, message, key).toString('base64');
  }
  // RSA-PSS / SHA-256 / MGF1-SHA256 / salt length = digest length (K3)
  return crypto
    .sign('sha256', message, {
      key,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
    })
    .toString('base64');
}

/**
 * Exact pre-sign text: timestamp(ms) + METHOD + path-without-query.
 * K1: "Sign the full request path from the API root, without query parameters."
 */
export function presignText(timestampMs, method, pathWithQuery) {
  const path = String(pathWithQuery).split('?')[0];
  return `${timestampMs}${String(method).toUpperCase()}${path}`;
}

/**
 * Build the three auth headers for a REST request.
 * @param {object} keyPair result of loadPrivateKey*
 * @param {string} keyId   KALSHI-ACCESS-KEY
 * @param {string} method  GET/POST/DELETE...
 * @param {string} path    e.g. /trade-api/v2/portfolio/balance?x=1 (query stripped)
 * @param {number} [atMs]  injected clock, for tests
 */
export function authHeaders(keyPair, keyId, method, path, atMs = Date.now()) {
  const timestamp = String(Math.trunc(atMs));
  const signature = signText(keyPair, presignText(timestamp, method, path));
  return {
    'KALSHI-ACCESS-KEY': keyId,
    'KALSHI-ACCESS-SIGNATURE': signature,
    'KALSHI-ACCESS-TIMESTAMP': timestamp,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
}

/**
 * WebSocket handshake headers. K8: sign timestamp + "GET" + "/trade-api/ws/v2",
 * which is the path portion of the WS URL on every documented host.
 */
export function wsHandshakeHeaders(keyPair, keyId, atMs = Date.now()) {
  return authHeaders(keyPair, keyId, 'GET', '/trade-api/ws/v2', atMs);
}

/** Verify a signature locally (used by the mock exchange and by tests). */
export function verifySignature(publicKeyPem, text, signatureB64, type) {
  const key = crypto.createPublicKey({ key: publicKeyPem, format: 'pem' });
  const sig = Buffer.from(signatureB64, 'base64');
  const message = Buffer.from(text, 'utf8');
  if (type === 'ed25519' || key.asymmetricKeyType === 'ed25519') {
    return crypto.verify(null, message, key, sig);
  }
  return crypto.verify('sha256', message, {
    key,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  }, sig);
}

/** Generate a demo key pair locally (for the mock exchange and local testing). */
export function generateKeyPair(type = 'ed25519') {
  if (type === 'rsa') {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
      privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      type: 'rsa'
    };
  }
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    type: 'ed25519'
  };
}
