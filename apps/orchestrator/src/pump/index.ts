import picomatch from 'picomatch';
import { RequirementsManager } from '../requirements/manager';
import { NotificationQueue } from '../notifications/index';
import type { PumpTickResult, Requirement } from '../requirements/types';
import { BUCKET_ORDER } from '../prioritization/bucketer';
import type { PriorityBucket } from '../prioritization/types';

function buildPrompt(req: Requirement): string {
  const spec = req.spec;
  const goals = spec?.goals.map((g) => `- ${g}`).join('\n') ?? '- (none specified)';
  const nonGoals = spec?.nonGoals.map((g) => `- ${g}`).join('\n') ?? '- (none specified)';
  const ac = spec?.acceptanceCriteria.map((c) => `- ${c}`).join('\n') ?? '- (none specified)';
  const notes = req.notes.map((n) => `[${n.ts}] ${n.text}`).join('\n') ?? '';
  const files = req.estimatedFiles.join(', ') || '(not specified)';
  const date = new Date().toISOString().slice(0, 10);
  const cwd = req.targetProject ?? '~';

  return `You are executing requirement ${req.id} — ${req.title}.

## Spec
${req.description}

## Goals
${goals}

## Non-goals
${nonGoals}

## Acceptance criteria
${ac}

## Files expected to touch
${files}

## Notes
${notes}

<conductor files="${req.estimatedFiles.join(',') || '**'}" depends_on=""/>

Anti-hang: 3min bash, 15s network. Report "done" only when acceptance criteria are verified. Write final report to ${cwd}/reports/req-${req.id}-${date}.md with before/after evidence.
`;
}

function filesOverlap(aGlobs: string[], bGlobs: string[]): boolean {
  if (aGlobs.length === 0 || bGlobs.length === 0) return false;
  for (const ag of aGlobs) {
    const isMatchA = picomatch(ag);
    for (const bg of bGlobs) {
      const isMatchB = picomatch(bg);
      // Check if either glob matches the other as a pattern (heuristic)
      if (isMatchA(bg) || isMatchB(ag) || ag === bg) return true;
    }
  }
  return false;
}

export class PumpEngine {
  constructor(
    private readonly reqManager: RequirementsManager,
    private readonly notifications: NotificationQueue,
  ) {}

  async tick(): Promise<PumpTickResult> {
    // All executing requirements — used for file conflict check
    const executing = this.reqManager.list({ state: 'executing' });

    // All ready requirements ordered by priority_bucket + position_ordinal first;
    // falls back to legacy priority (1-5) + capturedAt when not yet scored.
    const candidates = this.reqManager
      .list({ state: 'ready' })
      .filter((r) => this.reqManager.allDepsDone(r))
      .sort((a, b) => {
        const aBucket = a.priorityBucket as PriorityBucket | undefined;
        const bBucket = b.priorityBucket as PriorityBucket | undefined;
        if (aBucket && bBucket) {
          const bucketDiff = BUCKET_ORDER[aBucket] - BUCKET_ORDER[bBucket];
          if (bucketDiff !== 0) return bucketDiff;
          return (a.positionOrdinal ?? 0) - (b.positionOrdinal ?? 0);
        }
        // Legacy fallback: lower priority number = higher priority
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.capturedAt.localeCompare(b.capturedAt);
      });

    const eligible = candidates.find((req) => {
      // File conflict: does any executing req's estimatedFiles overlap with this one?
      return !executing.some((ex) => filesOverlap(ex.estimatedFiles, req.estimatedFiles));
    });

    if (!eligible) {
      return { picked: null, prompt: null, cwd: null };
    }

    // Claim it
    await this.reqManager.setState(eligible.id, 'executing');
    const claimed = this.reqManager.get(eligible.id)!;

    const prompt = buildPrompt(claimed);
    const cwd = claimed.targetProject ?? process.env['HOME'] ?? '~';

    this.notifications.enqueue(
      claimed.id,
      'started',
      `Requirement "${claimed.title}" started`,
      'both',
    );

    return { picked: claimed, prompt, cwd };
  }

  async onTaskCompleted(reqId: string, taskId: string): Promise<void> {
    const req = this.reqManager.get(reqId);
    if (!req) return;
    if (req.state !== 'executing') return;

    await this.reqManager.linkTask(reqId, taskId);
    await this.reqManager.setState(reqId, 'verifying');
    await this.reqManager.setState(reqId, 'done');

    this.notifications.enqueue(
      reqId,
      'completed',
      `Requirement "${req.title}" done — task ${taskId} completed`,
      'both',
    );
  }
}

export { buildPrompt, filesOverlap };
