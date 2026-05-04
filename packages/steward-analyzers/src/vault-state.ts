/**
 * Vault-state analyzers — failure modes #7 (backup pipeline silent
 * failure) and #9 (token expiry approaching). Per the architecture
 * doc §3.7 and §3.9 + memory directive `steward_gatekeeper_directive.md`
 * (modes 7, 9).
 *
 * Mode #8 (audit-log unbounded growth) is also implementable here; it's
 * a small extension of the snapshot-age check (just looks at a
 * different file's mtime). Included as `checkAuditLogRotation` for
 * symmetry.
 *
 * As with `local-state.ts`, the analyzers are pure: they accept
 * already-collected raw inputs (mtimes for snapshot/audit-log,
 * structured secret records with `*_expires_at` fields). The CLI shim
 * is responsible for the side-effects (filesystem stat, vault read).
 *
 * Why pure functions: the actual signal sources are heterogeneous —
 * Mac filesystem mtimes for the local snapshot, stolution-remote
 * filesystem mtimes for the remote snapshot, vault `*_expires_at`
 * fields for token rotation. Each platform has different access
 * primitives. Keeping the analyzer logic decoupled means we can
 * trivially mock for tests and route around platform quirks in the
 * CLI shim.
 */

import type { Finding, Severity } from './types.js';

// ── Failure mode #7 — backup pipeline silent failure ──────────────────────

export interface SnapshotEntry {
  /** Side identifier (e.g. 'mac', 'stolution'). */
  side: string;
  /** Filesystem path of the most-recent snapshot file. */
  path: string | null;
  /** Modification time as Unix epoch seconds; null if no snapshot found. */
  mtimeEpoch: number | null;
}

export interface CheckSnapshotAgeOptions {
  /** Snapshot entries from each side that the operator expects to be fresh. */
  snapshots: ReadonlyArray<SnapshotEntry>;
  /** Reference "now" for age computation. Default Date.now()/1000. */
  nowEpoch?: number;
  /**
   * Max acceptable snapshot age in hours. Default 26 — matches the existing
   * `com.stolution.vault-snapshot-pull` check threshold.
   */
  maxAgeHours?: number;
}

export function checkSnapshotAge({
  snapshots,
  nowEpoch = Math.floor(Date.now() / 1000),
  maxAgeHours = 26,
}: CheckSnapshotAgeOptions): Finding[] {
  const findings: Finding[] = [];
  const maxAgeSec = maxAgeHours * 3600;

  for (const entry of snapshots) {
    if (entry.mtimeEpoch === null) {
      findings.push({
        analyzer: 'vault-state',
        ruleId: 'snapshot-missing',
        path: entry.path ?? `<${entry.side}>`,
        severity: 'high',
        message: `No snapshot found on ${entry.side} side. Vault backup pipeline is broken or never ran.`,
        remediation: `Inspect the ${entry.side}-side snapshot job (cron / LaunchAgent). On Mac: 'launchctl list com.stolution.vault-snapshot-pull'. On stolution: 'crontab -l | grep vault-snapshot'.`,
        context: { side: entry.side },
      });
      continue;
    }
    const ageSec = nowEpoch - entry.mtimeEpoch;
    if (ageSec > maxAgeSec) {
      const ageHours = Math.round(ageSec / 3600);
      findings.push({
        analyzer: 'vault-state',
        ruleId: 'snapshot-stale',
        path: entry.path ?? `<${entry.side}>`,
        severity: 'high',
        message: `Most recent ${entry.side}-side snapshot is ${ageHours}h old (threshold ${maxAgeHours}h). Backup pipeline silently failing.`,
        remediation: `Verify the ${entry.side}-side snapshot job last exit code + log. Re-run manually: on Mac, 'launchctl kickstart -k gui/$UID/com.stolution.vault-snapshot-pull'.`,
        context: { side: entry.side, ageHours, maxAgeHours },
      });
    }
  }

  return findings;
}

// ── Failure mode #8 — audit log unbounded growth ──────────────────────────

export interface AuditLogState {
  /** Path to the audit log file. */
  path: string;
  /** File size in bytes. null if not present. */
  sizeBytes: number | null;
  /** mtime of the most recent rotation marker file. null if no rotation observed. */
  rotationMtimeEpoch: number | null;
}

export interface CheckAuditLogRotationOptions {
  state: AuditLogState;
  nowEpoch?: number;
  maxRotationAgeHours?: number;
  /** Per architecture doc §3.8: 1 GB = block growth alarm. */
  maxSizeBytes?: number;
}

export function checkAuditLogRotation({
  state,
  nowEpoch = Math.floor(Date.now() / 1000),
  maxRotationAgeHours = 26,
  maxSizeBytes = 1_000_000_000,
}: CheckAuditLogRotationOptions): Finding[] {
  const findings: Finding[] = [];

  if (state.sizeBytes !== null && state.sizeBytes > maxSizeBytes) {
    findings.push({
      analyzer: 'vault-state',
      ruleId: 'audit-log-oversized',
      path: state.path,
      severity: 'medium',
      message: `Audit log exceeded ${(maxSizeBytes / 1e9).toFixed(1)} GB (current: ${(state.sizeBytes / 1e9).toFixed(2)} GB). Rotation is broken or insufficient.`,
      remediation: `Check the rotation cron entry exists; force-run 'rotate-vault-audit.sh' manually.`,
      context: { sizeBytes: state.sizeBytes, maxSizeBytes },
    });
  }

  if (state.rotationMtimeEpoch !== null) {
    const ageSec = nowEpoch - state.rotationMtimeEpoch;
    const maxAgeSec = maxRotationAgeHours * 3600;
    if (ageSec > maxAgeSec) {
      findings.push({
        analyzer: 'vault-state',
        ruleId: 'audit-log-rotation-stale',
        path: state.path,
        severity: 'medium',
        message: `Last audit-log rotation was ${Math.round(ageSec / 3600)}h ago (threshold ${maxRotationAgeHours}h). Rotation cron may be unhealthy.`,
        remediation: `'crontab -l | grep rotate-vault-audit' to verify; manually invoke if needed.`,
        context: { ageHours: Math.round(ageSec / 3600), maxRotationAgeHours },
      });
    }
  }

  return findings;
}

// ── Failure mode #9 — token expiry approaching ────────────────────────────

export interface SecretRecord {
  /** Vault path or identifier. e.g. 'secret/stolution/prod/infrastructure'. */
  path: string;
  /** Logical key being tracked (often the token name). */
  key: string;
  /** Expiry as Unix epoch seconds; null = no expiry tracked. */
  expiresAtEpoch: number | null;
}

export interface CheckTokenExpiryOptions {
  /** All secrets that have an `*_expires_at` field. */
  secrets: ReadonlyArray<SecretRecord>;
  /** Reference "now". Default Date.now()/1000. */
  nowEpoch?: number;
  /** Days-to-expiry below which severity is medium. Default 30. */
  warnDays?: number;
  /** Days-to-expiry below which severity is high. Default 7. */
  highDays?: number;
}

export function checkTokenExpiry({
  secrets,
  nowEpoch = Math.floor(Date.now() / 1000),
  warnDays = 30,
  highDays = 7,
}: CheckTokenExpiryOptions): Finding[] {
  const findings: Finding[] = [];
  const day = 86400;

  for (const s of secrets) {
    if (s.expiresAtEpoch === null) continue; // no expiry tracked → out of scope
    const daysToExpiry = Math.floor((s.expiresAtEpoch - nowEpoch) / day);
    if (daysToExpiry > warnDays) continue; // healthy

    const severity: Severity = daysToExpiry <= highDays ? 'high' : 'medium';
    findings.push({
      analyzer: 'vault-state',
      ruleId: 'token-expiry-approaching',
      path: s.path,
      severity,
      message: `${s.key} at ${s.path} expires in ${daysToExpiry}d (threshold: warn ${warnDays}d, high ${highDays}d).`,
      remediation: `Run rotation: ~/bin/rotate-${s.key.toLowerCase()}.sh OR 'gh auth refresh' for github tokens. Update Vault entry after rotation.`,
      context: { key: s.key, daysToExpiry, warnDays, highDays },
    });
  }

  return findings;
}
