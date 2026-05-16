/**
 * HMAC-SHA256 signing for capability tokens.
 *
 * The broker signs a canonical JSON of (tokenId, name, scope, agentRole,
 * taskId, issuedAt, expiresAt, singleUse) so neither the issuer nor the
 * executor can mutate any field without invalidating the signature.
 *
 * The HMAC primitives (compute + constant-time compare) live in
 * `@chiefaia/hmac-auth`. This module composes them with the
 * canonical-payload layer and the `SigningKeyProvider` abstraction used
 * for key rotation.
 */

import { randomBytes } from 'node:crypto';

import { hmacSignHex, hmacVerify } from '@chiefaia/hmac-auth';

import type { CapabilityToken } from './types.js';

export interface SigningKeyProvider {
  /**
   * Return the active HMAC key. The provider is consulted once per
   * sign/verify call so callers can rotate keys without reconstructing the
   * broker.
   */
  getActiveKey(): Buffer;
  /**
   * Optional set of recently-rotated keys still considered valid for verify.
   * Used during key-rotation windows. Order is "newest first".
   */
  getAcceptedKeys?(): readonly Buffer[];
}

/**
 * Default in-memory key provider seeded from a single secret. Suitable for
 * unit tests and single-process deployments. For production, swap in a
 * provider that reads from the orchestrator's secrets store.
 */
export class StaticSigningKeyProvider implements SigningKeyProvider {
  private readonly key: Buffer;
  constructor(secret: string | Buffer) {
    if (!secret) {
      throw new Error('StaticSigningKeyProvider: secret must not be empty.');
    }
    const len =
      typeof secret === 'string' ? secret.length : (secret as Buffer).length;
    if (len < 16) {
      throw new Error(
        `StaticSigningKeyProvider: secret must be at least 16 bytes (received ${len}).`,
      );
    }
    this.key =
      typeof secret === 'string' ? Buffer.from(secret, 'utf8') : secret;
  }
  getActiveKey(): Buffer {
    return this.key;
  }
  getAcceptedKeys(): readonly Buffer[] {
    return [this.key];
  }
}

/**
 * Generate a token id — 16 random bytes hex (256-bit entropy is overkill
 * but harmless here, and fits the schema's min(16) constraint).
 */
export function newTokenId(): string {
  return randomBytes(16).toString('hex');
}

/** Canonicalise the signed-payload fields into deterministic JSON. */
function payloadCanonical(payload: Omit<CapabilityToken, 'signature'>): string {
  return JSON.stringify({
    tokenId: payload.tokenId,
    name: payload.name,
    scope: payload.scope,
    agentRole: payload.agentRole,
    taskId: payload.taskId,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    singleUse: payload.singleUse,
  });
}

export function signTokenPayload(
  payload: Omit<CapabilityToken, 'signature'>,
  provider: SigningKeyProvider,
): string {
  const key = provider.getActiveKey();
  return hmacSignHex(key, payloadCanonical(payload));
}

export function verifyTokenSignature(
  token: CapabilityToken,
  provider: SigningKeyProvider,
): boolean {
  const canonical = payloadCanonical(token);
  const candidates =
    provider.getAcceptedKeys?.() ?? [provider.getActiveKey()];

  for (const key of candidates) {
    if (hmacVerify(key, canonical, token.signature)) {
      return true;
    }
  }
  return false;
}

