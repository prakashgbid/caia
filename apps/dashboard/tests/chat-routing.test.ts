import { describe, it, expect } from 'vitest';
import { routeMessage } from '../lib/chat/routing';

describe('routeMessage — CAIA subagent routing', () => {
  it('routes a "decompose this story" message to caia-po', () => {
    const r = routeMessage('Decompose this story into Initiative -> Epic -> Story -> Task.');
    expect(r.agent).toBe('caia-po');
    expect(r.classification).toBe('decomposition');
    expect(r.matchedRule).not.toBeNull();
  });

  it('routes a "classify domain" message to caia-po (classification rule)', () => {
    const r = routeMessage('Classify this prompt domain into our taxonomy.');
    expect(r.agent).toBe('caia-po');
    expect(r.classification).toBe('classification');
  });

  it('routes a "enrich with acceptance criteria" message to caia-ba', () => {
    const r = routeMessage('Enrich this story with acceptance criteria + ticket template payload.');
    expect(r.agent).toBe('caia-ba');
    expect(r.classification).toBe('enrichment');
  });

  it('routes an "architecture decision" message to caia-ea', () => {
    // Uses unique architecture vocabulary so PO's classification rule doesn't fire first.
    const r = routeMessage('Make a build-vs-buy architecture call here.');
    expect(r.agent).toBe('caia-ea');
    expect(r.classification).toBe('architecture');
  });

  it('routes a DoD-check message to caia-validator', () => {
    const r = routeMessage('Run the definition of done checklist.');
    expect(r.agent).toBe('caia-validator');
    expect(r.classification).toBe('dod-check');
  });

  it('routes a premature-completion red-flag message to caia-validator', () => {
    const r = routeMessage('Premature completion: typecheck was skipped before merge.');
    expect(r.agent).toBe('caia-validator');
    expect(r.classification).toBe('red-flag');
  });

  it('routes a test-plan message to caia-test-design', () => {
    const r = routeMessage('Write the unit test plan for the new endpoint.');
    expect(r.agent).toBe('caia-test-design');
    expect(r.classification).toBe('plan-design');
  });

  it('routes an "implement this" message to caia-coding', () => {
    const r = routeMessage('Implement the new authentication endpoint.');
    expect(r.agent).toBe('caia-coding');
    expect(r.classification).toBe('implementation');
  });

  it('routes a "PR-flow" message to caia-coding (pr rule)', () => {
    const r = routeMessage('Open the PR and merge with auto-merge.');
    expect(r.agent).toBe('caia-coding');
    expect(r.classification).toBe('pr-flow');
  });

  it('routes a "CI failed" message to caia-fix-it', () => {
    const r = routeMessage('CI failed on PR 342 with a typecheck error.');
    expect(r.agent).toBe('caia-fix-it');
    expect(r.classification).toBe('failure-diagnosis');
  });

  it('routes a flake message to caia-fix-it', () => {
    const r = routeMessage('This test is flaky due to timing — recommend a retry.');
    expect(r.agent).toBe('caia-fix-it');
    expect(r.classification).toBe('flake-handling');
  });

  it('routes a gatekeeper-verdict message to caia-steward', () => {
    const r = routeMessage('Run the steward gatekeeper analysis on PR 342.');
    expect(r.agent).toBe('caia-steward');
    expect(r.classification).toBe('gatekeeper-verdict');
  });

  it('routes a lesson-capture message to caia-mentor', () => {
    const r = routeMessage('Capture this incident as a lesson; root cause was X.');
    expect(r.agent).toBe('caia-mentor');
    expect(r.classification).toBe('lesson-capture');
  });

  it('routes a curator action-routing message to caia-curator', () => {
    const r = routeMessage('Scan findings and emit alarms via caia-curator act.');
    expect(r.agent).toBe('caia-curator');
    expect(r.classification).toBe('action-routing');
  });

  it('defaults to caia-po with unrouted classification when no rule matches', () => {
    const r = routeMessage('Hi, how are you?');
    expect(r.agent).toBe('caia-po');
    expect(r.classification).toBe('unrouted');
    expect(r.matchedRule).toBeNull();
  });

  it('exposes the matched rule source for diagnostics', () => {
    const r = routeMessage('Decompose this.');
    expect(typeof r.matchedRule).toBe('string');
  });
});
