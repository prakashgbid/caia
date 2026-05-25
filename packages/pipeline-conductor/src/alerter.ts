/**
 * @caia/pipeline-conductor — alerter.ts
 *
 * Layer 5 alerter — subscribes to the three canonical drift event types
 * and surfaces them to operator visibility:
 *
 *   1. INBOX  — appends a markdown entry under "## DRIFT ALERTS" with
 *               deduplication (one entry per `(type, dedupKey)` per
 *               configurable window — defaults to 24 hours).
 *   2. Dashboard — appends a one-line summary to a daily markdown file
 *               (`~/Documents/projects/reports/drift_dashboard_YYYY-MM-DD.md`).
 *   3. Notifier — calls an optional pluggable hook for operator
 *               notification (e.g. a future Slack/macOS-notification
 *               bridge). Defaults to a no-op.
 *
 * Reference: research/ai_first_continuous_discipline_2026.md §7 Layer 5.
 */

import { eventBus } from '@chiefaia/event-bus-internal';
import type { ConductorEvent } from '@chiefaia/event-bus-internal';

/** Drift event types the alerter subscribes to. */
export const DRIFT_EVENT_TYPES = [
  'policy.violation.detected',
  'memory.consistency.broken',
  'architecture.principle.violated',
] as const;

export type DriftEventType = (typeof DRIFT_EVENT_TYPES)[number];

/** Filesystem abstraction — same shape as @caia/ea-architect's. */
export interface AlerterFsAdapter {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  appendFile(path: string, content: string): void;
  mkdir(path: string): void;
}

/** Operator notifier callback. */
export type OperatorNotifier = (notification: OperatorNotification) => void | Promise<void>;

export interface OperatorNotification {
  type: DriftEventType;
  severity: 'warning' | 'error';
  title: string;
  body: string;
  event: ConductorEvent;
}

export interface AlerterOptions {
  bus?: typeof eventBus;
  fs: AlerterFsAdapter;
  clock?: () => Date;
  /** Path to operator INBOX. */
  inboxPath: string;
  /**
   * Directory where daily drift_dashboard_YYYY-MM-DD.md files live.
   * Will be created if missing.
   */
  dashboardDir: string;
  /** Optional operator notifier. Defaults to no-op. */
  notifier?: OperatorNotifier;
  /** Dedup window in milliseconds. Default 24h. */
  dedupWindowMs?: number;
}

export const INBOX_SECTION_HEADER = '## DRIFT ALERTS';
const DEFAULT_DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const NOOP_NOTIFIER: OperatorNotifier = () => undefined;

export class Alerter {
  private readonly bus: typeof eventBus;
  private readonly fs: AlerterFsAdapter;
  private readonly clock: () => Date;
  private readonly inboxPath: string;
  private readonly dashboardDir: string;
  private readonly notifier: OperatorNotifier;
  private readonly dedupWindowMs: number;
  private readonly recentDedupKeys = new Map<string, number>();
  private unsubs: Array<() => void> = [];

  /** Telemetry counters. */
  public alertsObserved = 0;
  public inboxEntriesWritten = 0;
  public inboxEntriesDeduped = 0;
  public dashboardLinesWritten = 0;
  public notifierCalls = 0;
  public notifierErrors = 0;

  constructor(opts: AlerterOptions) {
    this.bus = opts.bus ?? eventBus;
    this.fs = opts.fs;
    this.clock = opts.clock ?? ((): Date => new Date());
    this.inboxPath = opts.inboxPath;
    this.dashboardDir = opts.dashboardDir;
    this.notifier = opts.notifier ?? NOOP_NOTIFIER;
    this.dedupWindowMs = opts.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
  }

  start(): void {
    if (this.unsubs.length > 0) return;
    for (const type of DRIFT_EVENT_TYPES) {
      this.unsubs.push(
        this.bus.subscribe(type, (event) => {
          void this.handleDriftEvent(event);
        }),
      );
    }
  }

  stop(): void {
    for (const unsub of this.unsubs) {
      try { unsub(); } catch { /* never throw on stop */ }
    }
    this.unsubs = [];
  }

  /**
   * Public surface so callers can invoke alerting without going through
   * the bus (useful in tests + for sibling code with the event already in
   * hand). Idempotent within the dedup window.
   */
  async handleDriftEvent(event: ConductorEvent): Promise<void> {
    if (!isDriftEventType(event.type)) return;
    this.alertsObserved += 1;

    const type = event.type as DriftEventType;
    const dedupKey = this.dedupKeyFor(type, event);
    const now = this.clock().getTime();
    this.purgeStaleDedupEntries(now);

    if (this.recentDedupKeys.has(dedupKey)) {
      this.inboxEntriesDeduped += 1;
      return;
    }
    this.recentDedupKeys.set(dedupKey, now);

    const rendered = renderAlertEntry(type, event, new Date(now));

    try { this.appendToInbox(rendered.inboxMarkdown); } catch (err) {
      // INBOX failures are surfaced but never throw to the bus.
      console.error('[alerter] inbox append failed', err);
    }

    try { this.appendToDashboard(rendered.dashboardLine, new Date(now)); } catch (err) {
      console.error('[alerter] dashboard append failed', err);
    }

    try {
      await Promise.resolve(this.notifier({
        type,
        severity: event.severity === 'error' ? 'error' : 'warning',
        title: rendered.title,
        body: rendered.body,
        event,
      }));
      this.notifierCalls += 1;
    } catch (err) {
      this.notifierErrors += 1;
      console.error('[alerter] notifier failed', err);
    }
  }

  /** Clear the dedup cache. Useful in tests. */
  resetDedupCache(): void {
    this.recentDedupKeys.clear();
  }

  // ─── INBOX writes ─────────────────────────────────────────────────────────

  private appendToInbox(entry: string): void {
    if (!this.fs.exists(this.inboxPath)) {
      this.fs.writeFile(this.inboxPath, `${INBOX_SECTION_HEADER}\n\n${entry}\n`);
      this.inboxEntriesWritten += 1;
      return;
    }
    const body = this.fs.readFile(this.inboxPath);
    if (body.includes(INBOX_SECTION_HEADER)) {
      // Insert the new entry immediately after the section header.
      const lines = body.split('\n');
      const idx = lines.findIndex((l) => l === INBOX_SECTION_HEADER);
      const before = lines.slice(0, idx + 1).join('\n');
      const after = lines.slice(idx + 1).join('\n');
      const newBody = `${before}\n\n${entry}\n${after.startsWith('\n') ? after : `\n${after}`}`;
      this.fs.writeFile(this.inboxPath, newBody);
    } else {
      const sep = body.endsWith('\n') ? '\n' : '\n\n';
      this.fs.writeFile(this.inboxPath, `${body}${sep}${INBOX_SECTION_HEADER}\n\n${entry}\n`);
    }
    this.inboxEntriesWritten += 1;
  }

  // ─── Dashboard writes ─────────────────────────────────────────────────────

  private appendToDashboard(line: string, when: Date): void {
    if (!this.fs.exists(this.dashboardDir)) this.fs.mkdir(this.dashboardDir);
    const day = isoDate(when);
    const filePath = `${this.dashboardDir.replace(/\/$/, '')}/drift_dashboard_${day}.md`;
    if (!this.fs.exists(filePath)) {
      this.fs.writeFile(filePath, `# Drift Dashboard — ${day}\n\n`);
    }
    this.fs.appendFile(filePath, `${line}\n`);
    this.dashboardLinesWritten += 1;
  }

  // ─── Dedup ────────────────────────────────────────────────────────────────

  private purgeStaleDedupEntries(nowMs: number): void {
    for (const [key, ts] of this.recentDedupKeys.entries()) {
      if (nowMs - ts > this.dedupWindowMs) this.recentDedupKeys.delete(key);
    }
  }

  private dedupKeyFor(type: DriftEventType, event: ConductorEvent): string {
    const p = event.payload as Record<string, unknown>;
    switch (type) {
      case 'policy.violation.detected':
        return `policy::${asStr(p.policy_id)}::${asStr(p.caller_agent_id)}::${asStr(p.mode)}`;
      case 'memory.consistency.broken':
        return `memory::${asStr(p.memory_file)}::${hashShort(asStr(p.claim))}`;
      case 'architecture.principle.violated':
        return `arch::${asStr(p.principle_id)}::${asStr(p.location)}`;
    }
  }
}

// ─── Rendering ──────────────────────────────────────────────────────────────

interface RenderedAlert {
  title: string;
  body: string;
  inboxMarkdown: string;
  dashboardLine: string;
}

export function renderAlertEntry(
  type: DriftEventType,
  event: ConductorEvent,
  when: Date,
): RenderedAlert {
  const ts = when.toISOString();
  const p = event.payload as Record<string, unknown>;

  switch (type) {
    case 'policy.violation.detected': {
      const policyId = asStr(p.policy_id);
      const mode = asStr(p.mode);
      const reason = asStr(p.reason);
      const caller = asStr(p.caller_agent_id);
      const fix = p.suggested_fix !== undefined ? asStr(p.suggested_fix) : '';
      const title = `[policy-violation] ${policyId} (${mode}) — ${reason.slice(0, 80)}`;
      const body = `Policy \`${policyId}\` (\`${mode}\`) violated by \`${caller}\`.\nReason: ${reason}` +
        (fix ? `\nSuggested fix: ${fix}` : '');
      return {
        title,
        body,
        inboxMarkdown: [
          `### ${ts} — drift: policy.violation.detected`,
          ``,
          `- **Policy**: \`${policyId}\``,
          `- **Mode**: \`${mode}\``,
          `- **Caller**: \`${caller}\``,
          `- **Reason**: ${reason}`,
          ...(fix ? [`- **Suggested fix**: ${fix}`] : []),
          `- **Event id**: \`${event.id}\``,
        ].join('\n'),
        dashboardLine: `- ${ts}  policy.violation.detected  policy=${policyId} mode=${mode} caller=${caller}`,
      };
    }
    case 'memory.consistency.broken': {
      const file = asStr(p.memory_file);
      const claim = asStr(p.claim);
      const actual = asStr(p.actual);
      const discoveredBy = asStr(p.discovered_by);
      const title = `[memory-drift] ${shortPath(file)} — ${claim.slice(0, 80)}`;
      const body = `Memory file \`${file}\` has drifted.\nClaim: ${claim}\nActual: ${actual}\nDiscovered by: ${discoveredBy}`;
      return {
        title,
        body,
        inboxMarkdown: [
          `### ${ts} — drift: memory.consistency.broken`,
          ``,
          `- **File**: \`${file}\``,
          `- **Claim**: ${claim}`,
          `- **Actual**: ${actual}`,
          `- **Discovered by**: \`${discoveredBy}\``,
          `- **Event id**: \`${event.id}\``,
        ].join('\n'),
        dashboardLine: `- ${ts}  memory.consistency.broken  file=${shortPath(file)} discovered_by=${discoveredBy}`,
      };
    }
    case 'architecture.principle.violated': {
      const principle = asStr(p.principle_id);
      const adr = p.adr_id !== undefined ? asStr(p.adr_id) : '';
      const location = asStr(p.location);
      const detectedAt = asStr(p.detected_at);
      const title = `[principle-violation] ${principle} — ${shortPath(location)}`;
      const body = `Principle \`${principle}\` violated at \`${location}\`.` +
        (adr ? `\nADR: ${adr}` : '') +
        `\nDetected at: ${detectedAt}`;
      return {
        title,
        body,
        inboxMarkdown: [
          `### ${ts} — drift: architecture.principle.violated`,
          ``,
          `- **Principle**: \`${principle}\``,
          ...(adr ? [`- **ADR**: \`${adr}\``] : []),
          `- **Location**: \`${location}\``,
          `- **Detected at**: \`${detectedAt}\``,
          `- **Event id**: \`${event.id}\``,
        ].join('\n'),
        dashboardLine: `- ${ts}  architecture.principle.violated  principle=${principle} location=${shortPath(location)}`,
      };
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function isDriftEventType(type: string): type is DriftEventType {
  return (DRIFT_EVENT_TYPES as readonly string[]).includes(type);
}

function asStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  return String(v);
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shortPath(p: string): string {
  if (p.length <= 60) return p;
  return `…${p.slice(-57)}`;
}

/** Stable 6-char hash for dedup keys (FNV-1a 32-bit, base36). */
function hashShort(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36).slice(0, 6);
}

// ─── In-memory FS adapter for tests ─────────────────────────────────────────

export class InMemoryAlerterFs implements AlerterFsAdapter {
  public files = new Map<string, string>();
  public dirs = new Set<string>();

  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  readFile(path: string): string {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`ENOENT: ${path}`);
    return v;
  }
  writeFile(path: string, content: string): void {
    this.files.set(path, content);
  }
  appendFile(path: string, content: string): void {
    this.files.set(path, (this.files.get(path) ?? '') + content);
  }
  mkdir(path: string): void {
    this.dirs.add(path);
  }
}
