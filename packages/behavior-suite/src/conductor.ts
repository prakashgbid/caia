/**
 * Conductor integration helpers for behavior tests.
 *
 * Posts test results to Conductor's behavior-tests API and wires
 * behavior test runs as events on task runs.
 */

export interface ConductorConfig {
  baseUrl: string;
  taskRunSessionId?: string;  // If set, each result is also recorded as a task_run_event
}

export interface BehaviorTestUpsertPayload {
  name: string;
  feature: string;
  scope: string;
  project_slug?: string;
  domain_slugs?: string[];
  source_path?: string;
  expected_behavior?: string;
  layout_contract?: Record<string, unknown>;
  notes?: string;
}

export interface BehaviorRunPayload {
  status: 'pass' | 'fail' | 'skip' | 'flaky';
  duration_ms?: number;
  evidence_url?: string;
  failure_excerpt?: string;
  git_sha?: string;
  ci?: boolean;
  run_at?: string;
}

export interface BehaviorFailurePayload {
  kind: 'regression' | 'new-bug' | 'flake';
  message: string;
  stack_excerpt?: string;
  conductor_blocker_id?: string;
}

export class ConductorBehaviorClient {
  constructor(private config: ConductorConfig) {}

  private get base(): string {
    return this.config.baseUrl.replace(/\/$/, '');
  }

  async upsertTest(payload: BehaviorTestUpsertPayload): Promise<{ id: string }> {
    const res = await fetch(`${this.base}/behavior-tests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`behavior_test_upsert failed: ${res.status}`);
    return res.json() as Promise<{ id: string }>;
  }

  async recordRun(testId: string, payload: BehaviorRunPayload): Promise<{ id: number }> {
    const res = await fetch(`${this.base}/behavior-tests/${testId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`behavior_run_record failed: ${res.status}`);

    const run = await res.json() as { id: number };

    // Also record as a task_run_event if session ID is configured
    if (this.config.taskRunSessionId) {
      try {
        await fetch(`${this.base}/task-runs/${this.config.taskRunSessionId}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_kind: `behavior_test.${payload.status}`,
            excerpt: `Behavior test run: status=${payload.status}, duration=${payload.duration_ms}ms`,
            payload: { test_id: testId, run_id: run.id, ...payload },
          }),
        });
      } catch {
        // Non-fatal: don't break test run if event posting fails
      }
    }

    return run;
  }

  async fileFailure(runId: number, payload: BehaviorFailurePayload): Promise<void> {
    const res = await fetch(`${this.base}/behavior-tests/runs/${runId}/failures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`behavior_failure_file failed: ${res.status}`);
  }

  async getCoverage(): Promise<unknown> {
    const res = await fetch(`${this.base}/behavior-tests/coverage`);
    if (!res.ok) throw new Error(`behavior_coverage failed: ${res.status}`);
    return res.json();
  }
}

/** Default Conductor client instance pointing to localhost:7776 */
export function defaultConductorClient(taskRunSessionId?: string): ConductorBehaviorClient {
  return new ConductorBehaviorClient({
    baseUrl: process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776',
    taskRunSessionId,
  });
}
