/**
 * Release Agent — Tier 4
 *
 * Manages the release pipeline for a completed prompt:
 *  - Aggregates all work (requirements → stories → tasks → task runs)
 *  - Generates a changelog entry and semantic version suggestion
 *  - Evaluates release readiness (all tasks completed, no failures)
 *  - Emits release-agent.report.ready
 */

import { getDb } from '../db/connection';
import { requirements, stories, tasks, taskRuns, prompts } from '../db/schema';
import { eq } from 'drizzle-orm';
import { eventBus } from '../events/bus-adapter';

export interface ReleaseAgentInput {
  promptId: string;
  correlationId: string;
}

export interface ReleaseReport {
  promptId: string;
  version: string;       // semantic version bump suggestion: 'major' | 'minor' | 'patch'
  changelogEntry: string;
  requirementsCompleted: number;
  storiesCompleted: number;
  tasksCompleted: number;
  filesChanged: string[];
  totalTokensUsed: number;
  readyForRelease: boolean;
  blockers: string[];
}

// ─── Main agent runner ────────────────────────────────────────────────────────

export async function runReleaseAgent(
  input: ReleaseAgentInput,
  db: ReturnType<typeof getDb>,
): Promise<ReleaseReport> {
  const { promptId, correlationId } = input;

  // Fetch the original prompt for context
  const [prompt] = await db.select().from(prompts).where(eq(prompts.id, promptId));

  // Aggregate all work done under this prompt
  const reqs = await db.select().from(requirements).where(eq(requirements.rootPromptId, promptId));

  let storiesCompleted = 0;
  let tasksCompleted = 0;
  let tasksFailed = 0;
  const allFilesChanged: string[] = [];
  let totalTokensUsed = 0;

  for (const req of reqs) {
    // Stories belong to this requirement via parentEntityId
    const reqStories = await db.select().from(stories)
      .where(eq(stories.parentEntityId, req.id));

    // 'verified' is the terminal-success status in the stories state machine
    storiesCompleted += reqStories.filter(s => s.status === 'verified').length;

    for (const story of reqStories) {
      if (!story.id) continue;

      const storyTasks = await db.select().from(tasks)
        .where(eq(tasks.parentEntityId, story.id));

      tasksCompleted += storyTasks.filter(t => t.status === 'completed').length;
      tasksFailed   += storyTasks.filter(t => t.status === 'failed').length;

      for (const task of storyTasks) {
        // Get the most recent task run for this task (by rootPromptId fallback via parentEntityId)
        const runs = await db.select().from(taskRuns)
          .where(eq(taskRuns.parentEntityId, task.id));

        const latestRun = runs[runs.length - 1];
        if (latestRun) {
          try { allFilesChanged.push(...(JSON.parse(latestRun.filesChanged ?? '[]') as string[])); } catch { /* ignore */ }
          totalTokensUsed += (latestRun.inputTokens ?? 0) + (latestRun.outputTokens ?? 0);
        }
      }
    }
  }

  const uniqueFiles = [...new Set(allFilesChanged)];
  const requirementsCompleted = reqs.filter(r => r.state === 'done').length;
  const blockers: string[] = [];

  if (tasksFailed > 0) {
    blockers.push(`${tasksFailed} task(s) failed and need resolution`);
  }
  if (requirementsCompleted < reqs.length) {
    blockers.push(`${reqs.length - requirementsCompleted} requirement(s) not yet completed`);
  }

  const readyForRelease = blockers.length === 0 && tasksCompleted > 0;

  // Generate changelog entry from prompt body
  const promptBody = prompt?.body ?? 'Feature implementation';
  const changelogEntry = [
    `## Changes for: ${promptBody.slice(0, 100)}`,
    ``,
    `- ${requirementsCompleted} requirement(s) implemented`,
    `- ${storiesCompleted} story(ies) completed`,
    `- ${tasksCompleted} task(s) executed`,
    `- ${uniqueFiles.length} file(s) changed`,
    `- ${Math.round(totalTokensUsed / 1000)}K tokens used`,
    ``,
    readyForRelease ? '✅ Ready for release' : `❌ Blocked: ${blockers.join('; ')}`,
  ].join('\n');

  // Suggest semver bump: patch for bug-fixes, minor for features
  const lowerBody = promptBody.toLowerCase();
  const version = (lowerBody.includes('bug') || lowerBody.includes('fix'))
    ? 'patch'
    : 'minor';

  // Emit completion event
  eventBus.publish({
    type: 'release-agent.report.ready',
    actor: 'release-agent',
    correlation_id: correlationId,
    entity_type: 'prompt',
    entity_id: promptId,
    payload: {
      promptId,
      correlationId,
      readyForRelease,
      tasksCompleted,
      tasksFailed,
      blockers,
    },
  });

  return {
    promptId,
    version,
    changelogEntry,
    requirementsCompleted,
    storiesCompleted,
    tasksCompleted,
    filesChanged: uniqueFiles,
    totalTokensUsed,
    readyForRelease,
    blockers,
  };
}
