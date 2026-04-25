export type CheckKind = 'file_exists' | 'url_200' | 'test_pass' | 'ui_region' | 'behavior_test' | 'commit_sha' | 'manual';
export type Severity = 'critical' | 'warning' | 'info';
export type RunStatus = 'pass' | 'fail' | 'error';

export interface CheckResult {
  checkKind: CheckKind;
  passed: boolean;
  expected: string;
  actual: string;
  severity: Severity;
  message: string;
  evidenceUrl?: string;
}

export interface EntityRef {
  kind: string;
  id: string;
  title?: string;
  description?: string;
  verificationPlan?: string[];
  acceptanceCriteria?: string[];
  sourcePath?: string;
  expectedBehavior?: string;
}

export interface RunResult {
  entityKind: string;
  entityId: string;
  checksTotal: number;
  checksPassed: number;
  scorePct: number;
  status: RunStatus;
  findings: CheckResult[];
  durationMs: number;
}
