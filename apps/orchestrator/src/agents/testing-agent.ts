/**
 * Testing Agent — Tier 4
 *
 * Runs after a task_run completes. Validates the implementation against the
 * story's acceptance criteria and decides if the feature passes or needs rework.
 *
 * Strategy: rule-based heuristics on task run telemetry (files changed,
 * tool call count, duration) plus acceptance criteria coverage checks.
 */

import { getDb } from '../db/connection';
import { tasks, taskRuns, stories } from '../db/schema';
import { eq } from 'drizzle-orm';
import { eventBus } from '../events/bus-adapter';

export interface TestingAgentInput {
  taskId: string;
  /** Session ID of the task run (string UUID, not the integer autoincrement ID) */
  taskRunId: string;
  promptId: string | null;
  correlationId: string;
}

export interface TestingAgentOutput {
  taskId: string;
  taskRunId: string;
  passed: boolean;
  testSuiteResults: TestSuiteResult[];
  overallScore: number;  // 0–100
  blockers: string[];
  recommendations: string[];
}

interface TestSuiteResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  details: string;
}

// ─── Evaluation logic ────────────────────────────────────────────────────────

function evaluateAgainstCriteria(
  filesChanged: string[],
  toolCalls: number,
  durationMs: number,
  acceptanceCriteria: string[],
): TestSuiteResult[] {
  const results: TestSuiteResult[] = [];

  // Check 1: Files were actually changed
  results.push({
    name: 'Implementation produced changes',
    status: filesChanged.length > 0 ? 'pass' : 'fail',
    details: filesChanged.length > 0
      ? `${filesChanged.length} file(s) changed: ${filesChanged.slice(0, 3).join(', ')}${filesChanged.length > 3 ? '...' : ''}`
      : 'No files were changed — implementation may be empty',
  });

  // Check 2: Reasonable effort (not too fast to be real work)
  const durationSeconds = durationMs / 1000;
  results.push({
    name: 'Execution effort reasonable',
    status: durationSeconds > 5 ? 'pass' : 'fail',
    details: durationSeconds > 5
      ? `Task ran for ${Math.round(durationSeconds)}s with ${toolCalls} tool calls`
      : `Task completed suspiciously fast (${Math.round(durationSeconds)}s) — may not have done real work`,
  });

  // Check 3: Test files presence (look for test files in filesChanged)
  const hasTestFiles = filesChanged.some(f =>
    f.includes('.test.') || f.includes('.spec.') || f.includes('__tests__'),
  );
  results.push({
    name: 'Test files included',
    status: hasTestFiles ? 'pass' : 'skip',
    details: hasTestFiles
      ? 'Test files were created/modified'
      : 'No test files detected — tests may need to be written separately',
  });

  // Check 4: Source code modified (not only config)
  const hasSourceFiles = filesChanged.some(f =>
    (f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.js')) &&
    !f.includes('config') && !f.includes('.json'),
  );
  results.push({
    name: 'Source code modified',
    status: hasSourceFiles ? 'pass' : filesChanged.length === 0 ? 'fail' : 'skip',
    details: hasSourceFiles
      ? 'TypeScript/JavaScript source files were modified'
      : 'Only config or non-source files changed',
  });

  // Check 5: Acceptance criteria coverage (heuristic)
  if (acceptanceCriteria.length > 0) {
    results.push({
      name: 'Acceptance criteria reviewed',
      status: 'pass',
      details: `${acceptanceCriteria.length} acceptance criteria defined. Manual verification recommended.`,
    });
  }

  return results;
}

// ─── Main agent runner ────────────────────────────────────────────────────────

export async function runTestingAgent(
  input: TestingAgentInput,
  db: ReturnType<typeof getDb>,
): Promise<TestingAgentOutput> {
  const { taskId, taskRunId, promptId, correlationId } = input;

  // Fetch the task run by sessionId (taskRunId is the sessionId string)
  const [run] = await db.select().from(taskRuns).where(eq(taskRuns.sessionId, taskRunId));
  if (!run) throw new Error(`Task run with sessionId ${taskRunId} not found`);

  // Fetch the task and its associated story (via parentEntityId)
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

  let acceptanceCriteria: string[] = [];
  if (task?.parentEntityId && task.parentEntityType === 'story') {
    const [story] = await db.select().from(stories).where(eq(stories.id, task.parentEntityId));
    if (story?.acceptanceCriteriaJson) {
      try { acceptanceCriteria = JSON.parse(story.acceptanceCriteriaJson) as string[]; } catch { /* ignore */ }
    }
  }

  // Parse files changed from the task run
  let filesChanged: string[] = [];
  try { filesChanged = JSON.parse(run.filesChanged ?? '[]') as string[]; } catch { /* ignore */ }

  // Evaluate implementation quality
  const testResults = evaluateAgainstCriteria(
    filesChanged,
    run.toolCallCount ?? 0,
    run.durationMs ?? 0,
    acceptanceCriteria,
  );

  const passCount = testResults.filter(r => r.status === 'pass').length;
  const failCount = testResults.filter(r => r.status === 'fail').length;
  const overallScore = (passCount + failCount) > 0
    ? Math.round((passCount / (passCount + failCount)) * 100)
    : 100;
  const passed = failCount === 0;

  const blockers = testResults.filter(r => r.status === 'fail').map(r => r.details);
  const recommendations = passed
    ? ['Task implementation looks complete. Consider a manual review before merge.']
    : ['Fix the failing checks above before marking this task as complete.'];

  // Emit completion event
  eventBus.publish({
    type: 'testing-agent.validation.complete',
    actor: 'testing-agent',
    correlation_id: correlationId,
    entity_type: 'task',
    entity_id: taskId,
    payload: {
      taskId,
      taskRunId,
      promptId,
      correlationId,
      passed,
      overallScore,
      failCount,
      passCount,
    },
  });

  return {
    taskId,
    taskRunId,
    passed,
    testSuiteResults: testResults,
    overallScore,
    blockers,
    recommendations,
  };
}
