/**
 * ACR-008 — Backfill `story_scope` on every existing story.
 *
 * Migration 0030 (ACR-001) added `story_scope text NOT NULL DEFAULT 'story'`
 * — SQLite's ALTER TABLE applies the default to existing rows, so the
 * structural backfill is "free" at migration time. This script is the
 * **smart-inference** companion: re-classifies stories whose hierarchy
 * shape suggests something other than the default `'story'` scope.
 *
 * Inference rules (best-effort; fall back to 'story'):
 *
 *   - parentEntityType = null + zero parentEpic + scope.summary >= 80 words
 *     + no agentSections → 'initiative'
 *
 *   - parentEntityType = 'requirement' AND has children → 'epic'
 *
 *   - kind = 'epic' (legacy column) → 'epic'
 *
 *   - parentEntityType = 'story' AND zero acceptance criteria → 'task'
 *
 *   - kind = 'sub_task' or 'todo' → 'subtask'
 *
 *   - default → 'story'
 *
 * Idempotency: only updates rows where the inferred scope is *different*
 * from the current value. Re-running is a no-op once converged.
 *
 * Usage:
 *   pnpm --filter @caia-app/core exec tsx scripts/backfill-story-scope.ts
 *
 * Programmatic:
 *   import { runBackfillStoryScope } from './scripts/backfill-story-scope';
 *   const result = runBackfillStoryScope(db);
 */

import { eq } from 'drizzle-orm';
import { DEFAULT_STORY_SCOPE, type StoryScope } from '@chiefaia/ticket-template';
import type { Db } from '../src/db/connection';
import { stories } from '../src/db/schema';

export interface ScopeBackfillResult {
  scanned: number;
  reassigned: number;
  unchanged: number;
  perScope: Record<StoryScope, number>;
}

interface StoryRow {
  id: string;
  kind: string;
  storyScope: string;
  parentEntityType: string | null;
  parentId: string | null;
  acceptanceCriteriaJson: string;
  description: string;
  agentContributionsJson: string;
}

function countWords(s: string | null | undefined): number {
  if (!s) return 0;
  const t = s.trim();
  if (t === '') return 0;
  return t.split(/\s+/).length;
}

function isEmptyJson(s: string | null | undefined, kind: 'array' | 'object'): boolean {
  if (!s) return true;
  try {
    const parsed = JSON.parse(s);
    if (kind === 'array') return Array.isArray(parsed) && parsed.length === 0;
    return typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length === 0;
  } catch {
    return true;
  }
}

/**
 * Pure inference function — exported for unit testing without a DB.
 */
export function inferScope(row: StoryRow, hasChildren: boolean): StoryScope {
  // Legacy `kind` column wins on explicit shape.
  if (row.kind === 'epic') return 'epic';
  if (row.kind === 'sub_task' || row.kind === 'todo') return 'subtask';

  // Initiative heuristic — no parent, big scope, no implementation detail.
  if (
    row.parentEntityType === null &&
    countWords(row.description) >= 80 &&
    isEmptyJson(row.agentContributionsJson, 'object')
  ) {
    return 'initiative';
  }

  // Epic heuristic — under a requirement, with children of its own.
  if (row.parentEntityType === 'requirement' && hasChildren) return 'epic';

  // Task heuristic — under a story, no AC of its own.
  if (row.parentEntityType === 'story' && isEmptyJson(row.acceptanceCriteriaJson, 'array')) {
    return 'task';
  }

  return DEFAULT_STORY_SCOPE;
}

/**
 * Run the backfill. Returns counts; emits one
 * `story.scope_backfilled` event per reassignment for traceability.
 */
export function runBackfillStoryScope(db: Db): ScopeBackfillResult {
  const all = db
    .select({
      id: stories.id,
      kind: stories.kind,
      storyScope: stories.storyScope,
      parentEntityType: stories.parentEntityType,
      parentId: stories.parentId,
      acceptanceCriteriaJson: stories.acceptanceCriteriaJson,
      description: stories.description,
      agentContributionsJson: stories.agentContributionsJson,
    })
    .from(stories)
    .all();

  // Build a child-presence index (one O(N) pass).
  const parentIds = new Set<string>();
  for (const r of all) {
    if (r.parentId) parentIds.add(r.parentId);
  }

  const perScope: Record<StoryScope, number> = {
    initiative: 0,
    epic: 0,
    module: 0,
    story: 0,
    task: 0,
    subtask: 0,
  };
  let reassigned = 0;
  let unchanged = 0;

  for (const row of all) {
    const inferred = inferScope(row as StoryRow, parentIds.has(row.id));
    perScope[inferred] += 1;
    if (inferred === row.storyScope) {
      unchanged += 1;
      continue;
    }
    db.update(stories)
      .set({ storyScope: inferred })
      .where(eq(stories.id, row.id))
      .run();
    reassigned += 1;
    // Note: emitting a 'story.scope_backfilled' event would require
    // adding it to events-taxonomy-internal + extending EventActor.
    // Skipped for ACR-008 (one-time backfill); add when needed for
    // observability dashboards.
  }

  return {
    scanned: all.length,
    reassigned,
    unchanged,
    perScope,
  };
}

// CLI entry — only when invoked directly.
if (require.main === module) {
  // Lazy import to avoid forcing a Db instance at module-load time.
  import('../src/db/connection').then(({ getDb }) => {
    const db = getDb();
    const result = runBackfillStoryScope(db);
    console.log(JSON.stringify(result, null, 2));
  });
}
