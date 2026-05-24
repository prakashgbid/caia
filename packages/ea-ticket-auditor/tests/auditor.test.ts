import { describe, expect, it } from 'vitest';

import { DEFAULT_DOD_CHECKS, EaTicketAuditor } from '../src/index.js';

const COMPLETE_TICKET = `# T-001 — Feature X

## Acceptance Criteria
- Given a user
- When they do X
- Then Y happens

## Tests
- Unit test for X
- E2E for full flow

## Non-Functional
- p95 < 100ms throughput
- WCAG 2.2 AA accessibility
- security review owner: @secteam
- metrics: spans, logs, tracing

## Architects: backend, frontend, security

## Rollout Plan
Phased rollout

## Rollback Plan
Feature flag

## Notes
no migration required; docs update; analytics event; DoR met; story split / atomic / one story one deploy.
`;

const INCOMPLETE_TICKET = '# T-002\n\nDo a thing.';

describe('EaTicketAuditor', () => {
  it('passes a complete ticket', () => {
    const auditor = new EaTicketAuditor();
    const result = auditor.audit({
      ticketId: 'T-001',
      ticketBody: COMPLETE_TICKET,
      submissionId: 's'
    });
    expect(result.pass).toBe(true);
    expect(result.completenessScore).toBe(1);
  });

  it('fails an incomplete ticket', () => {
    const auditor = new EaTicketAuditor();
    const result = auditor.audit({
      ticketId: 'T-002',
      ticketBody: INCOMPLETE_TICKET,
      submissionId: 's'
    });
    expect(result.pass).toBe(false);
    expect(result.completenessScore).toBeLessThan(1);
    expect(result.missingNonFunctional.length).toBe(4);
  });

  it('reports per-DoD results', () => {
    const auditor = new EaTicketAuditor();
    const result = auditor.audit({
      ticketId: 'T-002',
      ticketBody: INCOMPLETE_TICKET,
      submissionId: 's'
    });
    expect(result.dodResults.length).toBe(DEFAULT_DOD_CHECKS.length);
    const failed = result.dodResults.filter((r) => !r.pass);
    expect(failed.length).toBeGreaterThan(0);
  });
});
