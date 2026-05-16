export type CheckId = 'V1' | 'V2' | 'V3';

export interface CheckOptions {
  readonly cwd: string;
  readonly targetPackages: readonly string[];
  readonly consumerPackages?: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface CheckResult {
  readonly id: CheckId;
  readonly label: string;
  readonly command: string;
  readonly status: 'pass' | 'fail' | 'timeout' | 'skipped';
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly stdoutTail: string;
  readonly stderrTail: string;
}

export interface VerificationResult {
  readonly pass: boolean;
  readonly checks: readonly CheckResult[];
  readonly durationMs: number;
}

export const STDOUT_TAIL_LIMIT = 4000;
