/**
 * Operator-facing digest writer. Appends a markdown entry per cron tick
 * to <digestPath>. Operator's daily review picks this up.
 *
 * Format: each entry is a `## YYYY-MM-DD HH:MM — outcome` heading + a
 * short body. Pre-existing digest content is preserved (we append
 * rather than overwrite).
 */

import * as path from 'node:path';
import type {
  EvalAdapterReport,
  FsAccess,
  RegistryEntry,
  RetrainerOutcome,
  RetrainerRunResult
} from './types.js';

export interface DigestEntry {
  at: string;
  outcome: RetrainerOutcome;
  body: string;
}

export class DigestWriter {
  constructor(private readonly fs: FsAccess, private readonly digestPath: string) {}

  appendEntry(entry: DigestEntry): void {
    const dir = path.dirname(this.digestPath);
    if (!this.fs.exists(dir)) this.fs.mkdir(dir);
    if (!this.fs.exists(this.digestPath)) {
      this.fs.writeFile(this.digestPath, this.header());
    }
    const md = this.renderEntry(entry);
    if (this.fs.appendFile !== undefined) {
      this.fs.appendFile(this.digestPath, md);
    } else {
      const existing = this.fs.readFile(this.digestPath);
      this.fs.writeFile(this.digestPath, existing + md);
    }
  }

  private header(): string {
    return [
      '# Apprentice Retrainer — operator digest',
      '',
      'Each cron tick appends an entry below. Read top-to-bottom for chronological history.',
      '',
      ''
    ].join('\n');
  }

  private renderEntry(e: DigestEntry): string {
    const lines = [
      `## ${e.at} — ${humanLabel(e.outcome)}`,
      '',
      e.body,
      '',
      ''
    ];
    return lines.join('\n');
  }
}

function humanLabel(o: RetrainerOutcome): string {
  switch (o) {
    case 'skipped-no-delta':
      return 'skipped (no corpus delta)';
    case 'skipped-canary-active':
      return 'skipped (canary still active)';
    case 'trained-and-rejected':
      return 'trained, then rejected at eval gate';
    case 'trained-and-canary-promoted':
      return 'trained + promoted to canary';
    case 'canary-held-prompting-operator':
      return 'CANARY HELD — operator action required';
    case 'gated-pending-quality':
      return 'gated (corpus below quality floor)';
    case 'failed':
      return 'FAILED';
  }
}

/** Render the body for a given run result. */
export function renderBody(result: RetrainerRunResult, evalReport?: EvalAdapterReport): string {
  switch (result.kind) {
    case 'skipped-no-delta':
      return [
        `Corpus delta below threshold; no retraining triggered.`,
        ``,
        `- Delta: ${result.deltaCount} new pairs`,
        `- Last successful train: ${result.lastTrainAt ?? 'never'}`
      ].join('\n');
    case 'skipped-canary-active': {
      const c = result.canary;
      return [
        `Canary still in soak — ${result.daysHeld} day(s) held; not retraining.`,
        ``,
        `- Canary adapter: ${c.adapterName}`,
        `- Canary model: ${c.ollamaModelName ?? '(unset)'}`,
        `- Canary percent: ${c.canaryPercent ?? '(unset)'}`
      ].join('\n');
    }
    case 'trained-and-rejected': {
      const e = evalReport ?? result.evalReport;
      return [
        `Trained, but rejected at eval gate.`,
        ``,
        `- Adapter: ${result.adapterPath}`,
        `- Reason: ${result.reason}`,
        ...(e
          ? [
              `- WinRate: ${e.winRate.toFixed(3)}`,
              `- Decision: ${e.decision}`,
              `- Regressions: ${e.regressionFlags.length}`
            ]
          : [])
      ].join('\n');
    }
    case 'trained-and-canary-promoted': {
      const e = evalReport ?? result.evalReport;
      return [
        `Trained + promoted to canary.`,
        ``,
        `- Adapter: ${result.adapterPath}`,
        `- Canary percent: ${result.canaryPercent}%`,
        ...(e
          ? [
              `- WinRate: ${e.winRate.toFixed(3)}`,
              `- Decision: ${e.decision}`
            ]
          : [])
      ].join('\n');
    }
    case 'canary-held-prompting-operator':
      return [
        `**Operator action required** — canary has held for ${result.daysHeld} day(s).`,
        ``,
        `Run one of:`,
        `- \`caia-apprentice-retrainer promote-canary\` — promote to production`,
        `- \`caia-apprentice-retrainer reject-canary --reason "..."\` — reject + revert`,
        ``,
        `- Canary adapter: ${result.canary.adapterName}`,
        `- Canary model: ${result.canary.ollamaModelName ?? '(unset)'}`,
        `- Canary percent: ${result.canary.canaryPercent ?? '(unset)'}`
      ].join('\n');
    case 'gated-pending-quality':
      return [
        `Corpus below quality floor; training skipped.`,
        ``,
        `- Avg quality: ${result.avg.toFixed(3)}`,
        `- Final count: ${result.count}`,
        `- Reason: ${result.reason}`,
        ``,
        `Cron will retry on next scheduled tick. Gate auto-opens once corpus quality lifts.`
      ].join('\n');
    case 'failed':
      return [
        `**Retraining failed.**`,
        ``,
        `- Error kind: ${result.error.kind}`,
        `- Message: ${result.error.message}`,
        ``,
        `Cron will retry on next scheduled tick (Saturday 02:00).`
      ].join('\n');
  }
}

/** Convenience helper: derives the canary entry to log alongside the body. */
export function _canaryEntryNote(c: RegistryEntry): string {
  return `${c.adapterName} (${c.canaryPercent ?? '?'}%)`;
}
