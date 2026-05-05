/**
 * Local-preview-health analyzer — Phase 2c.
 *
 * Asserts that the always-on local preview deploys (per
 * `agent/memory/steward_local_preview_deploys_directive.md` and
 * `apps/local-preview-orchestrator/`) are healthy:
 *
 *   1. each configured site has an install dir + valid state.json
 *   2. the most recent deploy did not fail
 *   3. the most recent health check is recent (< staleness threshold)
 *   4. all sites have a current_sha pinned (initial deploy completed)
 *
 * Pure analyzer function — accepts already-collected per-site state and
 * returns Finding[]. The shell-side data collection (curl
 * http://127.0.0.1:5170/api/status) lives in the CLI shim
 * (bin/steward-gatekeeper.mjs).
 *
 * Reference: architecture doc §3.x, memory directive
 * `steward_local_preview_deploys_directive.md`.
 */

import type { Finding, Severity } from './types.js';

/** Per-site state shape returned by the local-preview status dashboard. */
export interface SiteStateInput {
  name: string;
  url: string;
  current_sha: string | null;
  previous_sha: string | null;
  last_deploy_at: string | null;
  last_deploy_status:
    | 'success'
    | 'noop'
    | 'build-failed'
    | 'health-check-failed'
    | 'rollback-failed'
    | 'disk-full'
    | 'aborted'
    | null;
  last_deploy_error: string | null;
  last_health_check_at: string | null;
  last_health_check_status: 'ok' | 'failed' | null;
  process_state: 'unknown' | 'running' | 'stopped';
}

export interface CheckLocalPreviewHealthOptions {
  /** Per-site state (one entry per configured site). */
  sites: ReadonlyArray<SiteStateInput>;
  /**
   * Whether the dashboard responded at all. If false we emit a high-severity
   * finding for the dashboard itself and skip per-site analysis.
   */
  dashboardReachable: boolean;
  /** Reference "now" timestamp (ISO) for staleness math. Default: Date.now(). */
  nowMs?: number;
  /** Staleness threshold in minutes for last_health_check_at. Default 10. */
  healthStalenessMinutes?: number;
}

const ANALYZER_ID = 'local-preview-health';

/**
 * Run the analyzer over already-collected per-site state.
 */
export function checkLocalPreviewHealth({
  sites,
  dashboardReachable,
  nowMs = Date.now(),
  healthStalenessMinutes = 10
}: CheckLocalPreviewHealthOptions): Finding[] {
  if (!dashboardReachable) {
    return [
      {
        analyzer: ANALYZER_ID,
        ruleId: 'dashboard-unreachable',
        path: '<repo>',
        severity: 'high',
        message:
          'Local-preview status dashboard at http://127.0.0.1:5170 is not responding. ' +
          'The deploy daemon and 3 site processes likely are not running.',
        remediation:
          "launchctl list | grep com.stolution.local-preview && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.stolution.local-preview.status-dashboard.plist"
      }
    ];
  }

  const findings: Finding[] = [];
  const stalenessMs = healthStalenessMinutes * 60 * 1000;

  for (const site of sites) {
    // Rule 1: site must have a current_sha pinned (initial deploy done).
    if (!site.current_sha) {
      findings.push({
        analyzer: ANALYZER_ID,
        ruleId: 'site-never-deployed',
        path: '<repo>',
        severity: 'medium',
        message: `Site '${site.name}' has no current_sha — initial deploy has not completed.`,
        remediation: `local-preview deploy ${site.name}`,
        context: { site: site.name }
      });
    }

    // Rule 2: last deploy must not be in a failure state.
    if (site.last_deploy_status && isFailedStatus(site.last_deploy_status)) {
      const severity: Severity = site.last_deploy_status === 'rollback-failed' ? 'high' : 'medium';
      findings.push({
        analyzer: ANALYZER_ID,
        ruleId: 'last-deploy-failed',
        path: '<repo>',
        severity,
        message: `Site '${site.name}' last deploy = ${site.last_deploy_status}: ${
          site.last_deploy_error ?? 'unknown'
        }`,
        remediation:
          `Investigate via: curl -s http://127.0.0.1:5170/api/logs/${site.name} | jq .\n` +
          `Then force a redeploy: local-preview deploy ${site.name}`,
        context: {
          site: site.name,
          status: site.last_deploy_status,
          error: site.last_deploy_error
        }
      });
    }

    // Rule 3: health check must not be stale.
    if (site.last_health_check_at) {
      const healthMs = Date.parse(site.last_health_check_at);
      if (Number.isFinite(healthMs) && nowMs - healthMs > stalenessMs) {
        findings.push({
          analyzer: ANALYZER_ID,
          ruleId: 'health-check-stale',
          path: '<repo>',
          severity: 'medium',
          message: `Site '${site.name}' last health check at ${site.last_health_check_at} is older than ${healthStalenessMinutes}m.`,
          remediation: `local-preview deploy ${site.name}    # forces a fresh check`,
          context: {
            site: site.name,
            ageMs: nowMs - healthMs,
            thresholdMs: stalenessMs
          }
        });
      }
    } else if (site.current_sha) {
      // Has been deployed but never health-checked? Suspicious.
      findings.push({
        analyzer: ANALYZER_ID,
        ruleId: 'health-check-never-run',
        path: '<repo>',
        severity: 'low',
        message: `Site '${site.name}' has current_sha but no last_health_check_at — was the deploy supervisor running?`,
        context: { site: site.name }
      });
    }

    // Rule 4: last health-check status must be ok if present.
    if (site.last_health_check_status === 'failed') {
      findings.push({
        analyzer: ANALYZER_ID,
        ruleId: 'health-check-failed',
        path: '<repo>',
        severity: 'high',
        message: `Site '${site.name}' last health check FAILED.`,
        remediation: `curl -s http://127.0.0.1:5170/api/logs/${site.name} | tail -20`,
        context: { site: site.name }
      });
    }
  }

  return findings;
}

function isFailedStatus(status: NonNullable<SiteStateInput['last_deploy_status']>): boolean {
  return (
    status === 'build-failed' ||
    status === 'health-check-failed' ||
    status === 'rollback-failed' ||
    status === 'disk-full' ||
    status === 'aborted'
  );
}
