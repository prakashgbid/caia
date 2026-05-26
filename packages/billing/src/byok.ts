/**
 * `byok.ts` — Layer 2: BYOK runtime credit management.
 *
 * Customer pastes their own Anthropic / OpenAI / etc. API keys, which
 * we stash in their tenant-scoped Infisical vault. At runtime, the
 * generated app's AI features fetch the key on demand. Each read is
 * audit-logged.
 *
 * Subscription-only constraint applies to the BUILD phase (CAIA's own
 * agents calling Anthropic to *generate* the app — those go through
 * the operator's Max-account subscription via `spend-guard`). Runtime
 * (the tenant's generated app calling AI from production) is BYOK.
 *
 * Server-side validation: when a key is set, we make a single cheap
 * model-list call to confirm the key works. We do NOT call any
 * billable inference endpoint.
 */

import type { BillingEvents } from './events.js';
import type { SecretsAdapter, AccessContext } from './secrets-adapter.js';
import { isSecretNotFound } from './secrets-adapter.js';
import type { RuntimeKeyAuditStore } from './runtime-key-audit-store.js';
import {
  ByokProviderSchema,
  InvalidKeyError,
  RUNTIME_KEY_CATEGORY,
  RuntimeKeyNotSetError,
  runtimeKeyName,
  type ByokProvider,
  type RuntimeKeyReadAuditEntry,
} from './types.js';

export interface KeyValidator {
  /**
   * Confirm the key is well-formed and grants at least read access to
   * the provider's "list models" endpoint. MUST NOT call any billable
   * inference endpoint. Throw `InvalidKeyError` on failure.
   */
  validate(provider: ByokProvider, key: string): Promise<void>;
}

/**
 * Default validator — performs ONLY shape/prefix checks, no network
 * call. The dashboard wires in a network-backed validator at boot;
 * tests use this offline default.
 */
export class ShapeOnlyKeyValidator implements KeyValidator {
  async validate(provider: ByokProvider, key: string): Promise<void> {
    if (!key || typeof key !== 'string') {
      throw new InvalidKeyError(provider, 'key is empty');
    }
    if (key.length < 20) {
      throw new InvalidKeyError(provider, 'key is suspiciously short');
    }
    if (key.length > 8192) {
      throw new InvalidKeyError(provider, 'key is suspiciously long');
    }
    const expectedPrefix = PROVIDER_KEY_PREFIX[provider];
    if (expectedPrefix && !key.startsWith(expectedPrefix)) {
      throw new InvalidKeyError(
        provider,
        `expected prefix "${expectedPrefix}", got "${key.slice(0, 4)}…"`,
      );
    }
    // Cross-provider collision guard: openai's 'sk-' prefix is a
    // proper prefix of anthropic's 'sk-ant-', so a plain prefix check
    // would accept anthropic keys for openai. Reject explicitly.
    if (provider === 'openai' && key.startsWith('sk-ant-')) {
      throw new InvalidKeyError(
        provider,
        'key looks like an anthropic key (starts with sk-ant-)',
      );
    }
  }
}

const PROVIDER_KEY_PREFIX: Readonly<Partial<Record<ByokProvider, string>>> = {
  anthropic: 'sk-ant-',
  openai: 'sk-',
  google: 'AIza',
  mistral: '',
  cohere: '',
  azure: '',
  'aws-bedrock': '',
};

export interface ByokServiceConfig {
  secrets: SecretsAdapter;
  auditStore: RuntimeKeyAuditStore;
  events: BillingEvents;
  validator?: KeyValidator;
}

export class ByokService {
  private readonly validator: KeyValidator;

  constructor(private readonly config: ByokServiceConfig) {
    this.validator = config.validator ?? new ShapeOnlyKeyValidator();
  }

  /**
   * Set or rotate a tenant's runtime key for a given provider. The key
   * is validated server-side before being written; we never echo or
   * cache it in process memory.
   */
  async setRuntimeKey(
    tenantId: string,
    provider: ByokProvider,
    key: string,
  ): Promise<void> {
    ByokProviderSchema.parse(provider);
    await this.validator.validate(provider, key);

    // Detect whether this is a rotation (key already present) BEFORE
    // we overwrite, so the event payload is accurate.
    const rotated = await this.hasKey(tenantId, provider);

    await this.config.secrets.put(
      tenantId,
      RUNTIME_KEY_CATEGORY,
      runtimeKeyName(provider),
      key,
      { replace: true },
    );

    await this.config.events.runtimeKeySet({
      tenantId,
      provider,
      rotated,
      at: new Date(),
    });
  }

  /**
   * Read a runtime key. Every successful or failed read is audit-logged
   * via `RuntimeKeyAuditStore` AND emitted on the bus.
   *
   * Tenant isolation: the adapter scopes by `tenantId`. There is no
   * `getRuntimeKeyForAny()` — callers must know the tenant they're
   * acting on behalf of.
   */
  async getRuntimeKey(
    tenantId: string,
    provider: ByokProvider,
    callerContext: AccessContext,
  ): Promise<string> {
    ByokProviderSchema.parse(provider);

    const baseEntry: Omit<RuntimeKeyReadAuditEntry, 'ok' | 'errorClass'> = {
      tenantId,
      provider,
      callerType: callerContext.callerType,
      callerId: callerContext.callerId,
      ...(callerContext.ticketId !== undefined
        ? { ticketId: callerContext.ticketId }
        : {}),
      reason: callerContext.reason,
      readAt: new Date(),
    };

    try {
      const key = await this.config.secrets.get(
        tenantId,
        RUNTIME_KEY_CATEGORY,
        runtimeKeyName(provider),
        callerContext,
      );
      const audit: RuntimeKeyReadAuditEntry = { ...baseEntry, ok: true };
      await this.recordAudit(audit);
      return key;
    } catch (err) {
      if (isSecretNotFound(err)) {
        const audit: RuntimeKeyReadAuditEntry = {
          ...baseEntry,
          ok: false,
          errorClass: 'not_found',
        };
        await this.recordAudit(audit);
        throw new RuntimeKeyNotSetError(tenantId, provider);
      }
      const audit: RuntimeKeyReadAuditEntry = {
        ...baseEntry,
        ok: false,
        errorClass: 'provider_error',
      };
      await this.recordAudit(audit);
      throw err;
    }
  }

  async revokeRuntimeKey(
    tenantId: string,
    provider: ByokProvider,
  ): Promise<void> {
    ByokProviderSchema.parse(provider);
    try {
      await this.config.secrets.delete(
        tenantId,
        RUNTIME_KEY_CATEGORY,
        runtimeKeyName(provider),
      );
    } catch (err) {
      if (!isSecretNotFound(err)) throw err;
      // Idempotent: revoking an absent key is a no-op.
    }
    await this.config.events.runtimeKeyRevoked({
      tenantId,
      provider,
      at: new Date(),
    });
  }

  /**
   * List which providers the tenant has set keys for. Does NOT return
   * the keys themselves — just metadata so the dashboard can render a
   * "set / not set" matrix.
   */
  async listConfiguredProviders(tenantId: string): Promise<ByokProvider[]> {
    const metas = await this.config.secrets.list(
      tenantId,
      RUNTIME_KEY_CATEGORY,
    );
    const out: ByokProvider[] = [];
    for (const m of metas) {
      const guess = m.key.replace(/_api_key$/, '') as ByokProvider;
      const parsed = ByokProviderSchema.safeParse(guess);
      if (parsed.success) out.push(parsed.data);
    }
    return out;
  }

  /** Internal — quick existence check before set, for the `rotated` flag. */
  private async hasKey(
    tenantId: string,
    provider: ByokProvider,
  ): Promise<boolean> {
    const metas = await this.config.secrets.list(
      tenantId,
      RUNTIME_KEY_CATEGORY,
    );
    const target = runtimeKeyName(provider);
    return metas.some((m) => m.key === target);
  }

  private async recordAudit(entry: RuntimeKeyReadAuditEntry): Promise<void> {
    // Audit MUST succeed even if event emission fails — and vice versa.
    // We run them sequentially, but swallow event errors after the
    // audit row is committed; conversely, audit failures propagate.
    await this.config.auditStore.record(entry);
    try {
      await this.config.events.runtimeKeyRead(entry);
    } catch {
      // Bus subscriber threw — not a billing concern.
    }
  }
}
