// H-10 (chain-runner-battle-harden phase 5, 2026-05-14). Unified alerting
// backbone for the chain runner. Replaces the four ad-hoc INBOX/handoff/
// notification writers (src/watchdog.ts:appendInboxAlert, watchdog.js inbox
// append, _wake_helpers.sh:wake_emit_alert, and the various scripts that
// shelled `osascript` directly) with a single typed entry point.
//
// Channels (D-3):
//   handoff       — append a JSONL record to ~/.caia/handoff/active_alerts.jsonl;
//                   refresh_handoff.sh renders it into SESSION_HANDOFF.md's
//                   Active alerts section on its next tick (option B from the
//                   hardening plan — alerts are pulled, not inserted in-place).
//   inbox         — append a markdown block to ~/.caia/chain-watchdog/INBOX.md
//   notification  — macOS `osascript -e 'display notification ...'`
//   audit         — appendAudit on the per-chain audit.jsonl (event: alert_emitted)
//
// Anti-spam: each alert has a fingerprint = sha256(chain | type | day). The
// dedupe map at ~/.caia/chain-watchdog/.alert-dedupe.json tracks the
// last-emit timestamp per fingerprint. Within the 6h window the alert is
// suppressed on EVERY channel (so the loudest channel — osascript — cannot
// pager-storm even if the underlying condition oscillates).
//
// Force-flag bypasses dedupe; reserve for true incidents where a fresh page
// is genuinely warranted.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendAudit } from './audit.js';

export type AlertChannel = 'handoff' | 'inbox' | 'notification' | 'audit';

export type AlertType =
  | 'chain_stalled'
  | 'chain_rate_limited'
  | 'chain_auth_failed'
  | 'chain_preflight_failed'
  | 'chain_doctor_degraded'
  | 'operator_action_required'
  | 'cron_stall_detected'
  | string;

export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface AlertEvent {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  detail: string;
  /** Chain identifier — load-bearing for the dedupe fingerprint. */
  chain: string;
  evidence?: Record<string, unknown>;
  /**
   * When set, overrides the dedupe day component. Tests use this to drive
   * the fingerprint deterministically.
   */
  fingerprintDay?: string;
  /** Skip dedupe — fire even if a matching fingerprint is within the window. */
  force?: boolean;
  /** Per-event override of the default channel set for this type. */
  channels?: AlertChannel[];
}

export interface EmitAlertOptions {
  /** Per-chain audit.jsonl path (audit channel). */
  auditFile?: string;
  /** Default: ~/.caia/chain-watchdog/INBOX.md */
  inboxPath?: string;
  /** Default: ~/.caia/handoff/active_alerts.jsonl */
  alertsJsonlPath?: string;
  /** Default: ~/.caia/chain-watchdog/.alert-dedupe.json */
  dedupePath?: string;
  /** Dedupe window in seconds (default 6h). */
  dedupeWindowSec?: number;
  /** Channels resolved by the caller. When omitted, defaults-by-type apply. */
  configChannels?: string[];
  /** Injectable clock for tests. */
  now?: () => Date;
  /**
   * Toggle osascript invocation. Default true on darwin; tests may pass false.
   * (We always honor the channel selection — only the actual side-effect is
   * skipped.)
   */
  notificationsEnabled?: boolean;
  /** Custom spawn fn for the notification channel. Tests inject this. */
  spawn?: (cmd: string, args: string[]) => { status: number | null };
}

export interface EmitAlertResult {
  fingerprint: string;
  fired: AlertChannel[];
  suppressed: AlertChannel[];
  deduped: boolean;
  reason?: string;
}

// D-3 default channel set. The four "operator-must-see" event types get all
// four channels; the diagnostic ones (doctor_degraded, preflight_failed) stay
// quiet on notification to avoid pager fatigue. Per-event override via
// AlertEvent.channels and per-chain override via chain_config.alert_channels
// both take precedence over this default.
export const DEFAULT_CHANNELS_BY_TYPE: Readonly<Record<string, AlertChannel[]>> =
  Object.freeze({
    chain_stalled: ['handoff', 'inbox', 'notification', 'audit'],
    chain_rate_limited: ['handoff', 'inbox', 'notification', 'audit'],
    chain_auth_failed: ['handoff', 'inbox', 'notification', 'audit'],
    operator_action_required: ['handoff', 'inbox', 'notification', 'audit'],
    chain_preflight_failed: ['inbox', 'audit'],
    chain_doctor_degraded: ['inbox', 'audit'],
    cron_stall_detected: ['handoff', 'inbox', 'audit'],
  });

// Resolved lazily so tests can set CAIA_ALERT_* env vars after module load to
// redirect side effects into a tmpdir. (Static `const = process.env.X` would
// bake the value in at first import, which is awkward inside vitest.)
function defaultInboxPath(): string {
  return (
    process.env['CAIA_ALERT_INBOX_PATH'] ??
    join(homedir(), '.caia', 'chain-watchdog', 'INBOX.md')
  );
}
function defaultAlertsJsonlPath(): string {
  return (
    process.env['CAIA_ALERT_HANDOFF_JSONL_PATH'] ??
    join(homedir(), '.caia', 'handoff', 'active_alerts.jsonl')
  );
}
function defaultDedupePath(): string {
  return (
    process.env['CAIA_ALERT_DEDUPE_PATH'] ??
    join(homedir(), '.caia', 'chain-watchdog', '.alert-dedupe.json')
  );
}
function notificationsEnabledByEnv(): boolean {
  return process.env['CAIA_DISABLE_NOTIFICATIONS'] !== '1';
}
const DEFAULT_DEDUPE_WINDOW_SEC = 6 * 3600;
const KNOWN_CHANNELS: ReadonlySet<AlertChannel> = new Set<AlertChannel>([
  'handoff',
  'inbox',
  'notification',
  'audit',
]);

export function fingerprintForAlert(event: AlertEvent, now?: () => Date): string {
  const day =
    event.fingerprintDay ??
    (now ?? (() => new Date()))().toISOString().slice(0, 10);
  const raw = `${event.chain}|${event.type}|${day}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

interface DedupeFile {
  fingerprints: Record<string, string>;
}

function loadDedupe(p: string): DedupeFile {
  if (!existsSync(p)) return { fingerprints: {} };
  try {
    const raw = JSON.parse(readFileSync(p, 'utf8')) as unknown;
    if (
      raw &&
      typeof raw === 'object' &&
      'fingerprints' in raw &&
      typeof (raw as DedupeFile).fingerprints === 'object'
    ) {
      return raw as DedupeFile;
    }
  } catch {
    // fall-through to empty
  }
  return { fingerprints: {} };
}

function saveDedupe(p: string, state: DedupeFile): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function resolveChannels(
  event: AlertEvent,
  configChannels?: string[] | undefined,
): AlertChannel[] {
  if (event.channels && event.channels.length > 0) {
    return event.channels.filter((c): c is AlertChannel => KNOWN_CHANNELS.has(c));
  }
  if (configChannels && configChannels.length > 0) {
    const filtered = configChannels.filter((c): c is AlertChannel =>
      KNOWN_CHANNELS.has(c as AlertChannel),
    );
    if (filtered.length > 0) return filtered;
  }
  return DEFAULT_CHANNELS_BY_TYPE[event.type] ?? ['inbox', 'audit'];
}

export function emitAlert(
  channels: AlertChannel[] | undefined,
  event: AlertEvent,
  opts: EmitAlertOptions = {},
): EmitAlertResult {
  if (!event.chain || typeof event.chain !== 'string') {
    throw new Error('emitAlert: event.chain is required (load-bearing for fingerprint)');
  }
  const now = (opts.now ?? (() => new Date()))();
  const dedupeWindow = opts.dedupeWindowSec ?? DEFAULT_DEDUPE_WINDOW_SEC;
  const dedupePath = opts.dedupePath ?? defaultDedupePath();
  const inboxPath = opts.inboxPath ?? defaultInboxPath();
  const alertsPath = opts.alertsJsonlPath ?? defaultAlertsJsonlPath();
  const notificationsEnabled =
    opts.notificationsEnabled ?? notificationsEnabledByEnv();

  const resolved =
    channels && channels.length > 0
      ? channels.filter((c) => KNOWN_CHANNELS.has(c))
      : resolveChannels(event, opts.configChannels);

  const fp = fingerprintForAlert(event, opts.now);
  const dedupe = loadDedupe(dedupePath);
  const lastIso = dedupe.fingerprints[fp];
  const lastMs = lastIso ? Date.parse(lastIso) : NaN;
  const ageSec = Number.isFinite(lastMs)
    ? (now.getTime() - lastMs) / 1000
    : Infinity;
  const isDuplicate = !event.force && ageSec < dedupeWindow;

  if (isDuplicate) {
    if (opts.auditFile) {
      appendAudit(opts.auditFile, 'alert_suppressed_duplicate', {
        type: event.type,
        chain: event.chain,
        fingerprint: fp,
        age_sec_since_last: Math.floor(ageSec),
        dedupe_window_sec: dedupeWindow,
        intended_channels: resolved,
      });
    }
    return {
      fingerprint: fp,
      fired: [],
      suppressed: resolved,
      deduped: true,
      reason: 'duplicate_within_window',
    };
  }

  const fired: AlertChannel[] = [];
  const suppressed: AlertChannel[] = [];
  for (const ch of resolved) {
    try {
      switch (ch) {
        case 'audit':
          if (opts.auditFile) {
            appendAudit(opts.auditFile, 'alert_emitted', {
              type: event.type,
              severity: event.severity,
              title: event.title,
              detail: event.detail.slice(0, 500),
              chain: event.chain,
              fingerprint: fp,
              evidence: event.evidence ?? {},
              forced: event.force === true,
            });
            fired.push('audit');
          } else {
            suppressed.push('audit');
          }
          break;
        case 'inbox':
          writeInboxBlock(inboxPath, event, now, fp);
          fired.push('inbox');
          break;
        case 'handoff':
          writeHandoffJsonl(alertsPath, event, now, fp);
          fired.push('handoff');
          break;
        case 'notification':
          if (!notificationsEnabled) {
            suppressed.push('notification');
          } else {
            sendOsascriptNotification(event, opts.spawn);
            fired.push('notification');
          }
          break;
      }
    } catch {
      suppressed.push(ch);
    }
  }

  if (fired.length > 0) {
    // Record the EMIT time using the same clock that gated the decision, so
    // tests injecting a fake clock get deterministic behavior across calls.
    dedupe.fingerprints[fp] = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
    saveDedupe(dedupePath, dedupe);
  }

  return { fingerprint: fp, fired, suppressed, deduped: false };
}

function writeInboxBlock(
  path: string,
  event: AlertEvent,
  now: Date,
  fp: string,
): void {
  mkdirSync(dirname(path), { recursive: true });
  const header = existsSync(path) ? '' : '# Chain-Watchdog INBOX\n\n';
  const ts = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const evLines = Object.entries(event.evidence ?? {})
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n');
  const block =
    `${header}## [${ts}] ${event.type} — ${event.chain}\n` +
    `- severity: ${event.severity}\n` +
    `- title: ${event.title}\n` +
    `- detail: ${event.detail}\n` +
    `- fingerprint: ${fp}\n` +
    (evLines ? `${evLines}\n` : '') +
    '\n';
  appendFileSync(path, block);
}

function writeHandoffJsonl(
  jsonlPath: string,
  event: AlertEvent,
  now: Date,
  fp: string,
): void {
  mkdirSync(dirname(jsonlPath), { recursive: true });
  const entry = {
    ts: now.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    type: event.type,
    severity: event.severity,
    chain: event.chain,
    title: event.title,
    detail: event.detail.slice(0, 500),
    fingerprint: fp,
    evidence: event.evidence ?? {},
  };
  appendFileSync(jsonlPath, JSON.stringify(entry) + '\n');
}

function sendOsascriptNotification(
  event: AlertEvent,
  spawn?: (cmd: string, args: string[]) => { status: number | null },
): void {
  // Sanitize: osascript -e takes a single shell-escaped string; we use the
  // single-arg form, so the only injection vector is the script contents.
  // Replace double-quotes with apostrophes and cap length.
  const title = `caia ${event.type}`.replace(/"/g, "'").slice(0, 120);
  const body = `${event.chain}: ${event.detail}`
    .replace(/"/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 250);
  const script = `display notification "${body}" with title "${title}"`;
  const runner =
    spawn ??
    ((cmd: string, args: string[]) => {
      const out = spawnSync(cmd, args, { stdio: 'ignore', timeout: 5_000 });
      return { status: out.status };
    });
  runner('osascript', ['-e', script]);
}

// Convenience helper for callers that already have a chain context and want
// the typed defaults. Exists so wake-script-equivalent code in this package
// (watchdog.ts, the future stall-root-cause CLI) can stay terse.
export function emitChainAlert(
  event: AlertEvent,
  auditFile: string,
  opts: Omit<EmitAlertOptions, 'auditFile'> = {},
): EmitAlertResult {
  return emitAlert(undefined, event, { ...opts, auditFile });
}
