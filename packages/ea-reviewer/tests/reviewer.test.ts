import { describe, it, expect } from 'vitest';
import { Reviewer, review } from '../src/reviewer.js';
import {
  FixedCriticAdapter,
  NullCriticAdapter,
} from '../src/critic.js';
import type { ArchitectAuditRow } from '../src/types.js';
import {
  audit,
  cleanComposedArchitecture,
  cleanContracts,
  cleanReviewerInput,
  makeContract,
  stubTicket,
} from './fixtures.js';

describe('Reviewer.review — pass path', () => {
  it('passes a clean composed architecture', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const decision = await r.review(cleanReviewerInput());
    expect(decision.decision).toBe('pass');
    expect(decision.finalState).toBe('ea-complete-verified');
    expect(decision.rerunArchitects).toEqual([]);
  });

  it('summary describes a clean pass', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const decision = await r.review(cleanReviewerInput());
    expect(decision.summary).toMatch(/passed/i);
  });

  it('emits low-confidence advisories for sub-floor architects', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const input = cleanReviewerInput();
    const mutatedAudit: ArchitectAuditRow[] = input.auditRows.map((a) =>
      a.architectName === 'a11y' ? { ...a, confidence: 0.3 } : a,
    );
    const decision = await r.review({ ...input, auditRows: mutatedAudit });
    expect(decision.advisories.some((a) => a.architect === 'a11y')).toBe(true);
  });
});

describe('Reviewer.review — fail path', () => {
  it('fails when a required path is missing → rerun the owning architect', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const input = cleanReviewerInput();
    const broken = { ...input.composedArchitecture };
    delete broken['a11y.wcagLevel'];
    const decision = await r.review({ ...input, composedArchitecture: broken });
    expect(decision.decision).toBe('fail');
    expect(decision.finalState).toBe('ea-rejected');
    expect(decision.rerunArchitects.map((d) => d.architect)).toContain('a11y');
  });

  it('fails when a consistency invariant is violated → blames the named architect', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const input = cleanReviewerInput();
    const broken = { ...input.composedArchitecture };
    // Add an endpoint without rate-limit coverage
    broken['backend.endpointEnumeration'] = [
      { path: '/api/signup' },
      { path: '/api/admin' },
    ];
    const decision = await r.review({ ...input, composedArchitecture: broken });
    expect(decision.decision).toBe('fail');
    expect(decision.rerunArchitects.map((d) => d.architect)).toContain('apiGateway');
  });

  it('escalations become P0 rerun directives', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const input = cleanReviewerInput();
    const decision = await r.review({
      ...input,
      escalations: [
        {
          ruleId: 'same-rank-conflict',
          architects: ['security', 'devops'],
          reason: 'both want different secrets stores',
        },
      ],
    });
    expect(decision.decision).toBe('fail');
    expect(decision.rerunArchitects.length).toBeGreaterThanOrEqual(2);
    expect(decision.rerunArchitects.every((d) => d.severity === 'P0')).toBe(true);
  });

  it('correctness findings with a specific architect drive a rerun', async () => {
    const fixed = new FixedCriticAdapter([
      {
        acceptanceCriterion: 'AC',
        blameArchitect: 'analytics',
        reason: 'consent flow does not cover EU users',
        severity: 'P1',
      },
    ]);
    const r = new Reviewer({ critic: fixed });
    const decision = await r.review(cleanReviewerInput());
    expect(decision.decision).toBe('fail');
    expect(decision.rerunArchitects.map((d) => d.architect)).toContain('analytics');
  });

  it('correctness findings blaming global become advisories, not reruns', async () => {
    const fixed = new FixedCriticAdapter([
      {
        acceptanceCriterion: 'AC',
        blameArchitect: 'global',
        reason: 'no clear owner',
        severity: 'P1',
      },
    ]);
    const r = new Reviewer({ critic: fixed });
    const decision = await r.review(cleanReviewerInput());
    // Without a specific architect to blame, this doesn't force a rerun
    expect(decision.rerunArchitects).toEqual([]);
    // It IS an advisory
    expect(decision.advisories.some((a) => a.architect === 'global')).toBe(true);
  });
});

describe('Reviewer.review — deduplication + severity', () => {
  it('takes the highest severity per architect across multiple findings', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const input = cleanReviewerInput();
    const broken = { ...input.composedArchitecture };
    delete broken['a11y.wcagLevel']; // P1 missing-required (default)
    broken['a11y.keyboardSpec'] = []; // breaks interactive-widget invariant
    // Add escalation that names a11y at P0
    const decision = await r.review({
      ...input,
      composedArchitecture: broken,
      escalations: [
        {
          ruleId: 'esc',
          architects: ['a11y', 'frontend'],
          reason: 'see ya',
        },
      ],
    });
    const a11yEntry = decision.rerunArchitects.find((d) => d.architect === 'a11y');
    expect(a11yEntry?.severity).toBe('P0');
  });

  it('concatenates reasons for same-severity entries on the same architect', async () => {
    const r = new Reviewer({ critic: new NullCriticAdapter() });
    const input = cleanReviewerInput();
    const broken = { ...input.composedArchitecture };
    delete broken['a11y.wcagLevel'];
    broken['a11y.keyboardSpec'] = []; // breaks invariant
    broken['frontend.componentTree'] = [{ id: 'btn-1', interactive: true }];
    const decision = await r.review({ ...input, composedArchitecture: broken });
    const a11yEntry = decision.rerunArchitects.find((d) => d.architect === 'a11y');
    // Multiple reasons concatenated with `;`
    expect(a11yEntry?.reason).toMatch(/;/);
  });

  it('honors a custom blocking-severity set', async () => {
    const r = new Reviewer(
      { critic: new NullCriticAdapter() },
      { blockingSeverities: ['P0'] },
    );
    const input = cleanReviewerInput();
    const broken = { ...input.composedArchitecture };
    delete broken['a11y.wcagLevel']; // P1 default
    const decision = await r.review({ ...input, composedArchitecture: broken });
    // P1 missing-required no longer blocks
    expect(decision.decision).toBe('pass');
    // It DOES surface as an advisory
    expect(decision.advisories.some((a) => a.architect === 'a11y')).toBe(true);
  });
});

describe('Reviewer functional flavour', () => {
  it('review(input) without deps still works (default null critic)', async () => {
    const decision = await review(cleanReviewerInput());
    expect(decision.decision).toBe('pass');
  });
});

describe('Reviewer + escalation tie cases', () => {
  it('escalation with no architect names produces no rerun directives', async () => {
    const decision = await review({
      ticket: stubTicket(),
      composedArchitecture: cleanComposedArchitecture(),
      auditRows: cleanContracts().map((c) => audit(c.architectName)),
      contracts: cleanContracts(),
      escalations: [],
    });
    expect(decision.decision).toBe('pass');
  });

  it('handles a no-architects ticket (empty contracts / audit)', async () => {
    const decision = await review({
      ticket: stubTicket(),
      composedArchitecture: {},
      auditRows: [],
      contracts: [],
    });
    expect(decision.decision).toBe('pass');
    expect(decision.findings.completeness).toEqual([]);
  });

  it('failed architect → completeness finding for <all>', async () => {
    const decision = await review({
      ticket: stubTicket(),
      composedArchitecture: {},
      auditRows: [audit('failed-arch', { status: 'failed' })],
      contracts: [makeContract('failed-arch', ['failed-arch.x'])],
    });
    expect(decision.decision).toBe('fail');
    expect(decision.findings.completeness[0]?.missingPath).toBe('<all>');
  });
});
