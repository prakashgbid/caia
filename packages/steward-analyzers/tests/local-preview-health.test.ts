/**
 * Tests for the local-preview-health analyzer.
 *
 * Pure-function tests — drive the analyzer with synthetic per-site state
 * inputs and assert the right Findings come out. The shell-side data
 * collection (curl /api/status) is exercised in the bin/steward-gatekeeper.mjs
 * shim's smoke tests when the actual dashboard is reachable.
 */

import { describe, it, expect } from 'vitest';
import { checkLocalPreviewHealth, type SiteStateInput } from '../src/local-preview-health.js';

const okSite = (overrides: Partial<SiteStateInput> = {}): SiteStateInput => ({
  name: 'dashboard',
  url: 'http://localhost:5173',
  current_sha: 'abc1234',
  previous_sha: 'def5678',
  last_deploy_at: new Date().toISOString(),
  last_deploy_status: 'success',
  last_deploy_error: null,
  last_health_check_at: new Date().toISOString(),
  last_health_check_status: 'ok',
  process_state: 'running',
  ...overrides
});

describe('checkLocalPreviewHealth', () => {
  it('returns no findings when all sites are healthy', () => {
    const findings = checkLocalPreviewHealth({
      sites: [okSite(), okSite({ name: 'poker-zeno', url: 'http://localhost:5174' })],
      dashboardReachable: true
    });
    expect(findings).toEqual([]);
  });

  it('emits a high-severity finding when dashboard is unreachable', () => {
    const findings = checkLocalPreviewHealth({
      sites: [],
      dashboardReachable: false
    });
    expect(findings.length).toBe(1);
    expect(findings[0]!.ruleId).toBe('dashboard-unreachable');
    expect(findings[0]!.severity).toBe('high');
  });

  it('flags sites with no current_sha', () => {
    const findings = checkLocalPreviewHealth({
      sites: [okSite({ current_sha: null, last_deploy_status: null, last_health_check_at: null, last_health_check_status: null })],
      dashboardReachable: true
    });
    const f = findings.find((x) => x.ruleId === 'site-never-deployed');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('medium');
  });

  it('flags last-deploy-failed (build-failed)', () => {
    const findings = checkLocalPreviewHealth({
      sites: [okSite({ last_deploy_status: 'build-failed', last_deploy_error: 'compile error' })],
      dashboardReachable: true
    });
    const f = findings.find((x) => x.ruleId === 'last-deploy-failed');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('medium');
    expect(f!.message).toContain('compile error');
  });

  it('escalates rollback-failed to high', () => {
    const findings = checkLocalPreviewHealth({
      sites: [okSite({ last_deploy_status: 'rollback-failed', last_deploy_error: 'no previous build' })],
      dashboardReachable: true
    });
    const f = findings.find((x) => x.ruleId === 'last-deploy-failed');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('high');
  });

  it('flags stale health check', () => {
    const stale = new Date(Date.now() - 30 * 60_000).toISOString();
    const findings = checkLocalPreviewHealth({
      sites: [okSite({ last_health_check_at: stale })],
      dashboardReachable: true,
      healthStalenessMinutes: 10
    });
    const f = findings.find((x) => x.ruleId === 'health-check-stale');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('medium');
  });

  it('flags last health-check-failed at high severity', () => {
    const findings = checkLocalPreviewHealth({
      sites: [okSite({ last_health_check_status: 'failed' })],
      dashboardReachable: true
    });
    const f = findings.find((x) => x.ruleId === 'health-check-failed');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('high');
  });

  it('flags health-check-never-run when current_sha set but no health timestamp', () => {
    const findings = checkLocalPreviewHealth({
      sites: [okSite({ last_health_check_at: null, last_health_check_status: null })],
      dashboardReachable: true
    });
    const f = findings.find((x) => x.ruleId === 'health-check-never-run');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('low');
  });

  it('does not flag noop status as a failure', () => {
    const findings = checkLocalPreviewHealth({
      sites: [okSite({ last_deploy_status: 'noop' })],
      dashboardReachable: true
    });
    const f = findings.find((x) => x.ruleId === 'last-deploy-failed');
    expect(f).toBeUndefined();
  });

  it('handles multiple sites with mixed states', () => {
    const findings = checkLocalPreviewHealth({
      sites: [
        okSite(),
        okSite({ name: 'poker-zeno', last_deploy_status: 'build-failed' }),
        okSite({ name: 'roulette-community', current_sha: null, last_deploy_status: null, last_health_check_at: null })
      ],
      dashboardReachable: true
    });
    // poker-zeno → 1 finding (last-deploy-failed)
    // roulette-community → 1 finding (site-never-deployed)
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f) => f.message.includes('poker-zeno'))).toBe(true);
    expect(findings.some((f) => f.message.includes('roulette-community'))).toBe(true);
  });
});
