import type { EntityRef, RunResult, CheckResult } from './types';
import { verifyFiles } from './verifiers/file-verifier';
import { verifyUrls } from './verifiers/url-verifier';
import { verifyTests } from './verifiers/test-verifier';
import {
  entitiesCheckedTotal,
  checksTotal,
  findingsTotal,
  entityCheckDurationMs,
} from './metrics';

const CONDUCTOR_API = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

async function fetchEntities(): Promise<EntityRef[]> {
  const entities: EntityRef[] = [];

  try {
    // Fetch requirements
    const reqRes = await fetch(`${CONDUCTOR_API}/requirements`);
    if (reqRes.ok) {
      const reqs = await reqRes.json() as Array<Record<string, unknown>>;
      for (const r of reqs) {
        entities.push({
          kind: 'requirement',
          id: r['id'] as string,
          title: r['title'] as string,
          description: r['description'] as string,
          verificationPlan: JSON.parse((r['spec'] as string | null) ?? '[]').verificationPlan ?? [],
          acceptanceCriteria: [],
        });
      }
    }
  } catch { /* non-fatal */ }

  try {
    // Fetch stories
    const storyRes = await fetch(`${CONDUCTOR_API}/stories`);
    if (storyRes.ok) {
      const storyList = await storyRes.json() as Array<Record<string, unknown>>;
      for (const s of storyList) {
        entities.push({
          kind: 'story',
          id: s['id'] as string,
          title: s['title'] as string,
          description: s['description'] as string,
          verificationPlan: JSON.parse((s['verificationPlanJson'] as string | null) ?? (s['verification_plan_json'] as string | null) ?? '[]'),
          acceptanceCriteria: JSON.parse((s['acceptanceCriteriaJson'] as string | null) ?? (s['acceptance_criteria_json'] as string | null) ?? '[]'),
          expectedBehavior: (s['expectedBehavior'] as string | null) ?? (s['expected_behavior'] as string) ?? '',
          sourcePath: ((s['behaviorTestPath'] as string | null) ?? (s['behavior_test_path'] as string | null)) ?? undefined,
        });
      }
    }
  } catch { /* non-fatal */ }

  try {
    // Fetch behavior tests
    const btRes = await fetch(`${CONDUCTOR_API}/behavior-tests`);
    if (btRes.ok) {
      const bts = await btRes.json() as Array<Record<string, unknown>>;
      for (const bt of bts) {
        entities.push({
          kind: 'behavior_test',
          id: bt['id'] as string,
          title: bt['name'] as string,
          description: bt['expected_behavior'] as string,
          sourcePath: (bt['source_path'] as string | null) ?? undefined,
          verificationPlan: ['test_pass: Run associated behavior test suite'],
        });
      }
    }
  } catch { /* non-fatal */ }

  return entities;
}

async function reportRun(result: RunResult): Promise<void> {
  try {
    await fetch(`${CONDUCTOR_API}/completeness/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_kind: result.entityKind,
        entity_id: result.entityId,
        checks_total: result.checksTotal,
        checks_passed: result.checksPassed,
        score_pct: result.scorePct,
        status: result.status,
        findings: result.findings.filter(f => !f.passed).map(f => ({
          check_kind: f.checkKind,
          expected: f.expected,
          actual: f.actual,
          severity: f.severity,
          message: f.message,
          evidence_url: f.evidenceUrl,
        })),
        duration_ms: result.durationMs,
      }),
    });

    // If failed, create a re-execution blocker
    if (result.status === 'fail') {
      await fetch(`${CONDUCTOR_API}/blockers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Completeness failure: ${result.entityKind}/${result.entityId}`,
          severity: 'normal',
          kind: 'verification-failure',
          description: `Completeness score: ${result.scorePct}% (${result.checksPassed}/${result.checksTotal} checks passed)`,
          resolutionSteps: result.findings
            .filter(f => !f.passed)
            .map(f => f.message),
          state: 'open',
        }),
      });

      // Post timeline event
      await fetch(`${CONDUCTOR_API}/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'completeness_failure',
          actor: 'system',
          summary: `Completeness check failed for ${result.entityKind}/${result.entityId} — score ${result.scorePct}%`,
          subjectId: result.entityId,
          subjectKind: result.entityKind,
          payload: { score_pct: result.scorePct, findings_count: result.findings.filter(f => !f.passed).length },
        }),
      });
    }
  } catch (err) {
    console.error('Failed to report run:', err);
  }
}

export async function runSentinel(entities?: EntityRef[]): Promise<RunResult[]> {
  const toCheck = entities ?? await fetchEntities();
  const results: RunResult[] = [];

  for (const entity of toCheck) {
    const start = Date.now();
    const allChecks: CheckResult[] = [];

    // File checks
    allChecks.push(...verifyFiles(entity));

    // URL checks (async)
    const urlChecks = await verifyUrls(entity);
    allChecks.push(...urlChecks);

    // Test checks
    allChecks.push(...verifyTests(entity));

    // If no checks, add a "no verification plan" info check
    if (allChecks.length === 0) {
      allChecks.push({
        checkKind: 'manual',
        passed: false,
        expected: 'Verification plan defined',
        actual: 'No verification plan found',
        severity: 'warning',
        message: `⚠️ No verification plan for ${entity.kind}/${entity.id} — cannot auto-verify`,
      });
    }

    const passed = allChecks.filter(c => c.passed).length;
    const total = allChecks.length;
    const score = total > 0 ? Math.round((passed / total) * 100) : 0;
    const status = score === 100 ? 'pass' : (score >= 50 ? 'fail' : 'fail');

    const result: RunResult = {
      entityKind: entity.kind,
      entityId: entity.id,
      checksTotal: total,
      checksPassed: passed,
      scorePct: score,
      status,
      findings: allChecks,
      durationMs: Date.now() - start,
    };

    // Record per-entity metrics
    entitiesCheckedTotal.inc({ kind: entity.kind });
    entityCheckDurationMs.observe({ kind: entity.kind }, result.durationMs);
    for (const check of allChecks) {
      checksTotal.inc({ check_kind: check.checkKind, result: check.passed ? 'pass' : 'fail' });
      if (!check.passed) {
        findingsTotal.inc({ severity: check.severity, check_kind: check.checkKind });
      }
    }

    await reportRun(result);
    results.push(result);
  }

  return results;
}
