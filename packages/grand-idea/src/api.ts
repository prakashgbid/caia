/**
 * @caia/grand-idea — POST /api/grand-idea handler.
 *
 * Transport-agnostic. Works under Next.js route handlers, Cloudflare
 * Workers, or a Node HTTP server, since the signature is just
 * `(rawBody, headers) => Promise<{status, body}>`.
 *
 * Auth: a `CloudflareAccessVerifier` is injected. The real
 * implementation verifies a `Cf-Access-Jwt-Assertion` header against
 * Cloudflare's JWKS; tests inject a stub.
 */

import { z } from 'zod';

import { isGrandIdeaError } from './errors.js';
import type { GrandIdeaError } from './errors.js';
import type { IGrandIdeaPersistence } from './persistence.js';
import { advanceToIdeaCaptured } from './state-machine.js';
import {
  captureRequestSchema,
  type CaptureRequest,
  type CaptureResponse,
} from './types.js';

import type { StateMachine } from '@caia/state-machine';

/** Discriminated-union return type of `CloudflareAccessVerifier.verify`. */
export type AccessVerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'expired'; message: string };

/** Verifies a Cloudflare Access JWT (or any equivalent) and returns the verified email. */
export interface CloudflareAccessVerifier {
  verify(input: { headers: Readonly<Record<string, string | undefined>> }): Promise<AccessVerifyResult>;
}

/** Stub verifier for tests + local dev — always returns the configured email. */
export class StaticAccessVerifier implements CloudflareAccessVerifier {
  public constructor(private readonly email: string) {}
  public async verify(): Promise<AccessVerifyResult> {
    return { ok: true, email: this.email };
  }
}

/** Reject every request — useful for tests that exercise the auth-failed path. */
export class RejectAccessVerifier implements CloudflareAccessVerifier {
  public constructor(
    private readonly reason: 'missing' | 'invalid' | 'expired' = 'missing',
    private readonly message = 'no Cloudflare Access JWT in request',
  ) {}
  public async verify(): Promise<AccessVerifyResult> {
    return { ok: false, reason: this.reason, message: this.message };
  }
}

export interface CaptureHandlerOptions {
  persistence: IGrandIdeaPersistence;
  stateMachine: StateMachine;
  accessVerifier: CloudflareAccessVerifier;
  /** Inject a clock for deterministic tests; default is wall-clock. */
  clock?: () => Date;
}

export interface RawRequest {
  /** Parsed JSON body (caller decodes). */
  body: unknown;
  headers: Readonly<Record<string, string | undefined>>;
}

export interface HandlerResponse {
  status: number;
  body: CaptureResponse;
}

/**
 * Build a transport-agnostic POST handler for grand-idea capture.
 */
export function createCaptureHandler(opts: CaptureHandlerOptions) {
  const { persistence, stateMachine, accessVerifier } = opts;

  return async function handleCaptureRequest(req: RawRequest): Promise<HandlerResponse> {
    // 1) Auth.
    const auth: AccessVerifyResult = await accessVerifier.verify({ headers: req.headers });
    if (auth.ok === false) {
      const errorCode = auth.reason === 'missing' ? 'auth_missing' : 'auth_invalid';
      return {
        status: auth.reason === 'missing' ? 401 : 403,
        body: { ok: false, error: errorCode, message: auth.message },
      };
    }

    // 2) Validation.
    let parsed: CaptureRequest;
    try {
      parsed = captureRequestSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return {
          status: 400,
          body: {
            ok: false,
            error: 'validation_failed',
            message: 'one or more fields are invalid',
            details: { issues: err.issues },
          },
        };
      }
      return {
        status: 400,
        body: { ok: false, error: 'validation_failed', message: 'invalid request body' },
      };
    }

    // 3) Tenant lookup.
    let tenant;
    try {
      tenant = await persistence.readTenant(parsed.tenantSlug);
    } catch (err) {
      return errorResponse('persistence_failed', `failed to look up tenant: ${parsed.tenantSlug}`, err);
    }
    if (!tenant) {
      return {
        status: 404,
        body: {
          ok: false,
          error: 'tenant_not_found',
          message: `tenant '${parsed.tenantSlug}' does not exist`,
        },
      };
    }
    if (!tenant.onboardingComplete) {
      return {
        status: 409,
        body: {
          ok: false,
          error: 'tenant_not_onboarded',
          message: `tenant '${parsed.tenantSlug}' has not completed onboarding`,
        },
      };
    }

    // 4) Persistence write (per-tenant schema).
    let newRow;
    try {
      newRow = await persistence.writeGrandIdea({
        tenantSlug: parsed.tenantSlug,
        projectId: parsed.projectId,
        prompt: parsed.prompt,
        capturedBy: auth.email,
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      });
    } catch (err) {
      if (isGrandIdeaError(err)) {
        const status = err.code === 'validation_failed' ? 400 : 500;
        return {
          status,
          body: {
            ok: false,
            error: err.code === 'validation_failed' ? 'validation_failed' : 'persistence_failed',
            message: err.message,
            details: err.context,
          },
        };
      }
      return errorResponse('persistence_failed', 'failed to persist grand-idea row', err);
    }

    // 5) FSM advance.
    try {
      const fsm = await advanceToIdeaCaptured(stateMachine, {
        projectId: parsed.projectId,
        triggeredById: auth.email,
        triggeredByKind: 'operator',
        payload: { grand_idea_id: newRow.id, revision_number: newRow.revisionNumber },
      });
      return {
        status: 201,
        body: {
          ok: true,
          grandIdeaId: newRow.id,
          revisionNumber: newRow.revisionNumber,
          capturedAtIso: newRow.capturedAtIso,
          newState: 'idea-captured',
          newRowCreated: true,
          fsmAdvanced: fsm.applied,
        },
      };
    } catch (err) {
      if (isGrandIdeaError(err)) {
        const status = err.code === 'project_state_invalid' ? 409 : 500;
        return {
          status,
          body: {
            ok: false,
            error: err.code === 'project_state_invalid' ? 'project_state_invalid' : 'fsm_transition_failed',
            message: err.message,
            details: err.context,
          },
        };
      }
      return errorResponse('fsm_transition_failed', 'failed to advance project FSM', err);
    }
  };
}

function errorResponse(
  code: GrandIdeaError['code'],
  message: string,
  cause: unknown,
): HandlerResponse {
  return {
    status: 500,
    body: {
      ok: false,
      error: code,
      message,
      details: { cause: causeMessage(cause) },
    },
  };
}

function causeMessage(cause: unknown): string {
  if (cause === null || cause === undefined) return 'unknown';
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
