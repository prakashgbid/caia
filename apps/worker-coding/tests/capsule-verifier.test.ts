/**
 * Coding Agent capsule-verifier tests.
 *
 * Coverage:
 *   1. verifyBundleCapsule - ticket-missing branch
 *   2. verifyBundleCapsule - ticket-malformed branch (Zod parse fails)
 *   3. verifyBundleCapsule - no-frozen-hash branch (ticket has no capsuleHash)
 *   4. verifyBundleCapsule - hash-mismatch branch (ticket mutated post-freeze)
 *   5. verifyBundleCapsule - valid path (freshly frozen ticket round-trips)
 *   6. buildCapsuleDriftPayload - flattens drift info to a blocker shape
 *   7. buildCapsuleDriftPayload - captures null expected when no capsule frozen
 */

import {
  buildDraftTicket,
  freezeCapsule,
  type TicketTemplateV1,
} from '@chiefaia/ticket-template';
import {
  buildCapsuleDriftPayload,
  verifyBundleCapsule,
} from '../src/capsule-verifier';
import type { Bundle } from '../src/bundle-reader';

const TS = 1_700_000_000_000;

function makeTicket(): TicketTemplateV1 {
  return buildDraftTicket({
    rootPromptId: 'prm_capsule_worker_test_0123456789ab',
    requirementId: 'req_capsule_worker_001',
    domainPrimary: 'auth',
    domainAll: ['auth'],
    nature: 'feature',
    complexity: 'medium',
    summary: 'worker capsule test',
    inScope: ['login flow'],
    outOfScope: [],
    acceptanceCriteria: [
      'Given creds When POST /login Then 200',
      'Given expired token When refresh Then 401',
      'Given malformed body When POST /login Then 400',
    ],
    verificationPlan: ['unit'],
    files: ['apps/auth/src/login.ts'],
    poDecomposedAt: TS,
  });
}

function makeBundle(ticket: unknown): Bundle {
  return {
    story: {
      id: 'sty_001',
      title: 'login',
      description: '',
      status: 'ready_for_pickup',
      rootPromptId: 'prm_capsule_worker_test_0123456789ab',
      parentEntityId: null,
      parentEntityType: null,
      bucketId: null,
      templateVersion: 'v1',
      templateValidationStatus: 'valid',
      templateValidationErrors: null,
      enrichedAt: null,
      updatedAt: null,
    } as Bundle['story'],
    ticket,
    ticketParseError: null,
    prompt: null,
    requirement: null,
    bucket: null,
    labels: [],
    dependencies: { upstream: [], downstream: [] },
    inputDependencies: [],
  };
}

describe('verifyBundleCapsule', () => {
  it('returns ticket-missing when bundle.ticket is null', () => {
    const out = verifyBundleCapsule(makeBundle(null));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('ticket-missing');
  });

  it('returns ticket-malformed when ticket fails Zod parse', () => {
    const out = verifyBundleCapsule(makeBundle({ not: 'a ticket' }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('ticket-malformed');
  });

  it('returns no-frozen-hash when the ticket has no capsuleHash', () => {
    const ticket = makeTicket();
    const out = verifyBundleCapsule(makeBundle(ticket));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('no-frozen-hash');
  });

  it('returns hash-mismatch when the ticket was mutated post-freeze', () => {
    const frozen = freezeCapsule(makeTicket(), { now: TS });
    const tampered = {
      ...frozen,
      scope: { ...frozen.scope, summary: 'tampered' },
    };
    const out = verifyBundleCapsule(makeBundle(tampered));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('hash-mismatch');
      expect(out.verification.drift.expected).toBe(frozen.capsuleHash);
      expect(out.verification.drift.actual).not.toBe(frozen.capsuleHash);
    }
  });

  it('returns ok:true for a freshly-frozen ticket', () => {
    const frozen = freezeCapsule(makeTicket(), { now: TS });
    const out = verifyBundleCapsule(makeBundle(frozen));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.verification.expected).toBe(out.verification.actual);
      expect(out.verification.drift).toBeNull();
    }
  });
});

describe('buildCapsuleDriftPayload', () => {
  it('flattens drift info into the blocker payload', () => {
    const frozen = freezeCapsule(makeTicket(), { now: TS });
    const tampered = {
      ...frozen,
      acceptanceCriteria: [...frozen.acceptanceCriteria, 'extra AC'],
    };
    const out = verifyBundleCapsule(makeBundle(tampered));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const payload = buildCapsuleDriftPayload(makeBundle(tampered), out);
    expect(payload.storyId).toBe('sty_001');
    expect(payload.promptId).toBe('prm_capsule_worker_test_0123456789ab');
    expect(payload.expectedHash).toBe(frozen.capsuleHash);
    expect(payload.actualHash).not.toBe(frozen.capsuleHash);
    expect(payload.reason).toBe('hash-mismatch');
  });

  it('captures null expected when no capsule was frozen', () => {
    const ticket = makeTicket();
    const out = verifyBundleCapsule(makeBundle(ticket));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    const payload = buildCapsuleDriftPayload(makeBundle(ticket), out);
    expect(payload.expectedHash).toBeNull();
    expect(payload.reason).toBe('no-frozen-hash');
  });
});
