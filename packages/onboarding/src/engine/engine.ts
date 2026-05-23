/**
 * `@caia/onboarding` engine — the orchestrator that the wizard UI and
 * CLI both call. Responsibilities:
 *
 *  1. Hold the canonical ordered list of 19 categories.
 *  2. Compute "what's next" for a tenant (resume + idempotent reentry).
 *  3. Validate a submitted step via the provider validator.
 *  4. Persist secret_ref (not value) into Infisical via the secrets
 *     adapter, write credential row + choices + step status into the
 *     store, and audit-log everything.
 *  5. Mark the tenant onboarded when all mandatory categories pass /
 *     are deferred.
 *
 * Reference: research/step1_onboarding_spec_2026.md §2, §3, §5.
 */

import type {
  AuditLogEntry,
  CategoryDefinition,
  CategoryId,
  ProviderOption,
  ValidatorContext,
  ValidatorResult,
} from '../types.js';
import { ALL_CATEGORIES, getCategory, getProvider } from '../categories/index.js';
import { defaultContext } from '../validators/util.js';
import { validate } from '../validators/index.js';
import type { OnboardingStore } from '../store/types.js';

import {
  AUDIT_ACTIONS,
  type AuditAction,
  type EngineState,
  type SubmitStepInput,
  type SubmitStepResult,
} from './types.js';

/**
 * Minimal subset of `@caia/secrets-adapter#SecretsAdapter` the engine
 * actually uses. We declare it locally to avoid a runtime dependency
 * pulling the full @caia/secrets-adapter type-graph into the engine's
 * compile surface.
 */
export interface SecretsPutter {
  put(
    tenantId: string,
    category: string,
    key: string,
    value: string,
    opts?: { replace?: boolean },
  ): Promise<{ secretRef: string; version?: number }>;
}

export interface OnboardingEngineOptions {
  store: OnboardingStore;
  secrets: SecretsPutter;
  /** Used in audit rows for cross-system correlation. */
  infisicalBaseUrl?: string;
  /** Injected so tests can stub fetch/clock. */
  validatorCtx?: ValidatorContext;
}

export class OnboardingEngine {
  private readonly store: OnboardingStore;
  private readonly secrets: SecretsPutter;
  private readonly validatorCtx: ValidatorContext;
  private readonly infisicalBaseUrl: string;

  constructor(opts: OnboardingEngineOptions) {
    this.store = opts.store;
    this.secrets = opts.secrets;
    this.validatorCtx = opts.validatorCtx ?? defaultContext();
    this.infisicalBaseUrl = opts.infisicalBaseUrl ?? 'https://infisical.chiefaia.com';
  }

  /** The static category catalog, in display order. */
  categories(): readonly CategoryDefinition[] {
    return ALL_CATEGORIES;
  }

  /** Read engine state for a tenant; resume cursor is the lowest-ordinal
   *  mandatory step that's not yet `passed` or `deferred`. */
  async stateFor(tenantId: string): Promise<EngineState> {
    const rows = await this.store.listSteps(tenantId);
    const byCat = new Map<CategoryId, (typeof rows)[number]>(
      rows.map((r) => [r.category, r]),
    );
    const steps = ALL_CATEGORIES.map((c) => {
      const row = byCat.get(c.id);
      const item: EngineState['steps'][number] = {
        category: c,
        status: row?.status ?? 'pending',
        attemptCount: row?.attemptCount ?? 0,
      };
      if (row?.failureReason) item.failureReason = row.failureReason;
      return item;
    });
    const next = steps.find(
      (s) => s.category.required && !['passed', 'deferred'].includes(s.status),
    );
    const ready = steps
      .filter((s) => s.category.required)
      .every((s) => ['passed', 'deferred'].includes(s.status));
    const out: EngineState = {
      tenantId,
      steps,
      ready,
    };
    if (next) out.current = next.category;
    return out;
  }

  /** Mark a category deferred (only allowed for optional categories,
   *  or a required category whose provider supports a "skip" option). */
  async defer(
    tenantId: string,
    category: CategoryId,
    reason: string,
  ): Promise<void> {
    const cat = getCategory(category);
    if (!cat) throw new Error(`unknown category: ${category}`);
    if (cat.required) {
      throw new Error(`cannot defer required category: ${category}`);
    }
    await this.store.setStepStatus(tenantId, category, 'deferred', {
      required: cat.required,
      deferredReason: reason,
      lastValidatedAt: this.validatorCtx.now(),
    });
    await this.audit({
      tenantId,
      actorType: 'customer',
      action: AUDIT_ACTIONS.STEP_DEFERRED,
      category,
      payload: { reason },
      occurredAt: this.validatorCtx.now(),
    });
  }

  /**
   * The big one: validate a step submission, persist secrets, write
   * rows, audit, optionally finalize the tenant.
   *
   * Idempotency: re-submitting the same (tenantId, category, providerId,
   * credentials) is safe — secrets are PUT with replace:true, credential
   * row is upserted, step row is upserted.
   */
  async submitStep(input: SubmitStepInput): Promise<SubmitStepResult> {
    const cat = getCategory(input.category);
    if (!cat) {
      throw new Error(`unknown category: ${input.category}`);
    }
    const provider = getProvider(input.category, input.providerId);
    if (!provider) {
      throw new Error(
        `unknown provider for ${input.category}: ${input.providerId}`,
      );
    }
    // mark probing — increments attempt_count
    await this.store.setStepStatus(input.tenantId, input.category, 'probing', {
      required: cat.required,
      lastProbeAt: this.validatorCtx.now(),
    });
    await this.audit({
      tenantId: input.tenantId,
      actorType: input.actor?.actorType ?? 'customer',
      action: AUDIT_ACTIONS.STEP_STARTED,
      category: input.category,
      payload: { providerId: input.providerId },
      occurredAt: this.validatorCtx.now(),
      ...(input.actor?.actorId ? { actorId: input.actor.actorId } : {}),
      ...(input.actor?.requestIp ? { requestIp: input.actor.requestIp } : {}),
      ...(input.actor?.userAgent ? { userAgent: input.actor.userAgent } : {}),
    });

    let result: ValidatorResult;
    try {
      result = await validate(
        {
          tenantId: input.tenantId,
          category: input.category,
          providerId: input.providerId,
          choices: input.choices,
          credentials: input.credentials,
        },
        this.validatorCtx,
      );
    } catch (e) {
      result = {
        ok: false,
        providerId: input.providerId,
        errorCode: 'provider_error',
        message: `validator threw: ${(e as Error).message}`,
      };
    }

    // Persist choice rows regardless of success — the customer made
    // them, the operator will want them for forensics either way.
    await this.persistChoices(input);

    if (!result.ok) {
      await this.store.setStepStatus(input.tenantId, input.category, 'failed', {
        required: cat.required,
        failureReason: result.message,
        validationPayload: { errorCode: result.errorCode, message: result.message },
        lastValidatedAt: this.validatorCtx.now(),
      });
      await this.audit({
        tenantId: input.tenantId,
        actorType: input.actor?.actorType ?? 'customer',
        action: AUDIT_ACTIONS.STEP_FAILED,
        category: input.category,
        payload: { providerId: input.providerId, errorCode: result.errorCode, message: result.message },
        occurredAt: this.validatorCtx.now(),
        ...(input.actor?.actorId ? { actorId: input.actor.actorId } : {}),
      });
      return { status: 'failed', validator: result, credentialRefs: [] };
    }

    // Success — PUT each storable credential into Infisical, write
    // credential rows pointing at the secret_ref.
    const refs = await this.persistCredentials(input, provider, result);

    await this.store.setStepStatus(input.tenantId, input.category, 'passed', {
      required: cat.required,
      validationPayload: { providerId: result.providerId, metadata: result.metadata },
      lastValidatedAt: this.validatorCtx.now(),
    });
    await this.audit({
      tenantId: input.tenantId,
      actorType: input.actor?.actorType ?? 'customer',
      action: AUDIT_ACTIONS.STEP_PASSED,
      category: input.category,
      payload: { providerId: result.providerId, credentialRefs: refs },
      occurredAt: this.validatorCtx.now(),
      ...(input.actor?.actorId ? { actorId: input.actor.actorId } : {}),
    });

    // Finalize when every mandatory step is passed / deferred.
    const stateAfter = await this.stateFor(input.tenantId);
    if (stateAfter.ready) {
      const tenant = await this.store.getTenant(input.tenantId);
      if (tenant && !tenant.onboardingComplete) {
        await this.store.markTenantOnboarded(input.tenantId);
        await this.audit({
          tenantId: input.tenantId,
          actorType: 'system',
          action: AUDIT_ACTIONS.TENANT_ONBOARDED,
          payload: {},
          occurredAt: this.validatorCtx.now(),
        });
      }
    }

    return { status: 'passed', validator: result, credentialRefs: refs };
  }

  private async persistChoices(input: SubmitStepInput): Promise<void> {
    await this.store.putChoice({
      tenantId: input.tenantId,
      category: input.category,
      choiceKey: 'provider',
      choiceValue: input.providerId,
      source: 'wizard',
    });
    for (const [k, v] of Object.entries(input.choices)) {
      if (k === 'provider') continue;
      await this.store.putChoice({
        tenantId: input.tenantId,
        category: input.category,
        choiceKey: k,
        choiceValue: v,
        source: 'wizard',
      });
    }
  }

  private async persistCredentials(
    input: SubmitStepInput,
    provider: ProviderOption,
    result: ValidatorResult,
  ): Promise<string[]> {
    if (!result.ok) return [];
    const refs: string[] = [];
    for (const desc of provider.credentialDescriptors) {
      const value = input.credentials[desc.keyId];
      if (!value) continue;
      if (!desc.storeSecret) {
        // DNS proof tokens and the like: validated but not persisted.
        await this.audit({
          tenantId: input.tenantId,
          actorType: input.actor?.actorType ?? 'customer',
          action: AUDIT_ACTIONS.CREDENTIAL_VALIDATED,
          category: input.category,
          keyId: desc.keyId,
          payload: { providerId: input.providerId, stored: false },
          occurredAt: this.validatorCtx.now(),
        });
        continue;
      }
      const put = await this.secrets.put(
        input.tenantId,
        input.category,
        desc.keyId,
        value,
        { replace: true },
      );
      await this.audit({
        tenantId: input.tenantId,
        actorType: input.actor?.actorType ?? 'customer',
        action: AUDIT_ACTIONS.CREDENTIAL_PUT,
        category: input.category,
        keyId: desc.keyId,
        payload: {
          providerId: input.providerId,
          secretRef: put.secretRef,
          backend: 'infisical',
          baseUrl: this.infisicalBaseUrl,
        },
        occurredAt: this.validatorCtx.now(),
      });
      await this.store.putCredential({
        tenantId: input.tenantId,
        category: input.category,
        keyId: desc.keyId,
        secretRef: put.secretRef,
        archetype: desc.archetype,
        provider: input.providerId,
        scopesGranted: result.scopesGranted,
        scopesRequired: desc.scopesRequired,
        status: 'active',
        validatedAt: this.validatorCtx.now(),
        metadata: result.metadata,
      });
      refs.push(put.secretRef);
    }
    return refs;
  }

  private async audit(
    entry: Omit<AuditLogEntry, 'occurredAt'> & { occurredAt?: Date },
  ): Promise<void> {
    const e: AuditLogEntry = {
      tenantId: entry.tenantId,
      actorType: entry.actorType,
      action: entry.action as AuditAction,
      payload: entry.payload ?? {},
      occurredAt: entry.occurredAt ?? this.validatorCtx.now(),
    };
    if (entry.actorId) e.actorId = entry.actorId;
    if (entry.category) e.category = entry.category;
    if (entry.keyId) e.keyId = entry.keyId;
    if (entry.requestIp) e.requestIp = entry.requestIp;
    if (entry.userAgent) e.userAgent = entry.userAgent;
    await this.store.appendAudit(e);
  }
}
