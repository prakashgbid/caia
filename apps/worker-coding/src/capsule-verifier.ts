/**
 * Capsule Verifier (CAPSULE-FORMALIZE — third-party paper §C.5).
 *
 * The Coding Agent's first action on a freshly-claimed story is to
 * verify the Context Capsule that was frozen by the orchestrator at the
 * `bucket_placed -> ready_for_pickup` transition. If the capsule's
 * SHA-256 does not match the recomputed hash from the bundle's ticket,
 * the worker raises a `capsule-drift` blocker rather than acting on
 * stale context.
 *
 * Drift typically indicates an upstream agent (BA / EA / Validator)
 * re-ran on the story between freeze and pickup, mutating the ticket's
 * fields without re-freezing. The right escalation is to ask the
 * orchestrator to re-freeze the capsule (resolving drift legitimately)
 * rather than to silently let the worker code against the stale spec.
 */

import {
  TicketTemplateV1Schema,
  verifyCapsule,
  type CapsuleVerification,
  type TicketTemplateV1,
} from '@chiefaia/ticket-template';
import type { Bundle } from './bundle-reader';

export type CapsuleVerifyReason =
  | 'no-frozen-hash'
  | 'hash-mismatch'
  | 'ticket-missing'
  | 'ticket-malformed';

export type CapsuleVerifyOutcome =
  | {
      ok: true;
      verification: Extract<CapsuleVerification, { valid: true }>;
    }
  | {
      ok: false;
      verification: Extract<CapsuleVerification, { valid: false }>;
      reason: CapsuleVerifyReason;
    };

/**
 * Verify the capsule on a freshly-fetched bundle. Returns a shaped
 * outcome rather than throwing — the runtime decides whether to
 * escalate via blocker or retry.
 */
export function verifyBundleCapsule(bundle: Bundle): CapsuleVerifyOutcome {
  if (bundle.ticket === null) {
    return {
      ok: false,
      reason: 'ticket-missing',
      verification: {
        valid: false,
        drift: { expected: null, actual: '', reason: 'no-frozen-hash' },
      },
    };
  }

  // The bundle's `ticket` is `unknown` per the BundleSchema (the
  // orchestrator validates server-side and we trust that), but to call
  // verifyCapsule we need a typed TicketTemplateV1 — re-parse defensively.
  const parseResult = TicketTemplateV1Schema.safeParse(bundle.ticket);
  if (!parseResult.success) {
    return {
      ok: false,
      reason: 'ticket-malformed',
      verification: {
        valid: false,
        drift: { expected: null, actual: '', reason: 'no-frozen-hash' },
      },
    };
  }

  const ticket: TicketTemplateV1 = parseResult.data;
  const verification = verifyCapsule(ticket);
  if (verification.valid) {
    return { ok: true, verification };
  }
  return {
    ok: false,
    reason: verification.drift.reason,
    verification,
  };
}

/**
 * Capsule-drift blocker payload — the structured info the worker hands
 * to the orchestrator when it escalates rather than executes.
 */
export interface CapsuleDriftBlockerPayload {
  storyId: string;
  promptId: string | null;
  expectedHash: string | null;
  actualHash: string;
  reason: CapsuleVerifyReason;
}

/**
 * Build the structured payload the runtime hands to its orchestrator
 * client to register the `capsule-drift` blocker. The blocker is a
 * standard CAIA blocker (severity: warning), not a custom kind — it
 * routes through the same escalation path as `validation-stuck` and
 * `dod-self-check-failed` blockers.
 */
export function buildCapsuleDriftPayload(
  bundle: Bundle,
  outcome: Extract<CapsuleVerifyOutcome, { ok: false }>,
): CapsuleDriftBlockerPayload {
  return {
    storyId: bundle.story.id,
    promptId: bundle.story.rootPromptId,
    expectedHash: outcome.verification.drift.expected,
    actualHash: outcome.verification.drift.actual,
    reason: outcome.reason,
  };
}
