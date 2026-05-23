/**
 * Engine-facing shapes — what the wizard server hands to the engine
 * and what the engine hands back. Re-exported via the package barrel.
 */

import type {
  CategoryDefinition,
  CategoryId,
  StepStatus,
  ValidatorResult,
} from '../types.js';

/** What the wizard submits when the customer finishes one screen. */
export interface SubmitStepInput {
  tenantId: string;
  category: CategoryId;
  providerId: string;
  /** Choice values (provider, region, …) — non-secret. */
  choices: Record<string, unknown>;
  /** Raw credential values, keyed by descriptor.keyId. */
  credentials: Record<string, string>;
  /** Operator-supplied actor context for audit. */
  actor?: {
    actorType: 'customer' | 'operator' | 'agent' | 'system';
    actorId?: string;
    requestIp?: string;
    userAgent?: string;
  };
}

export interface SubmitStepResult {
  status: StepStatus;
  validator: ValidatorResult;
  credentialRefs: string[];
}

export interface EngineState {
  tenantId: string;
  current?: CategoryDefinition;
  steps: Array<{
    category: CategoryDefinition;
    status: StepStatus;
    attemptCount: number;
    failureReason?: string;
  }>;
  /** When true, every mandatory category is passed or deferred. */
  ready: boolean;
}

/** Audit action vocabulary used by the engine. */
export const AUDIT_ACTIONS = {
  STEP_STARTED: 'onboarding.step.started',
  STEP_PASSED: 'onboarding.step.passed',
  STEP_FAILED: 'onboarding.step.failed',
  STEP_DEFERRED: 'onboarding.step.deferred',
  CREDENTIAL_PUT: 'credential.put',
  CREDENTIAL_VALIDATED: 'credential.validated',
  TENANT_ONBOARDED: 'onboarding.completed',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
