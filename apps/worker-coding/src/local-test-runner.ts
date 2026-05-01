/**
 * LocalTestRunner — CODING-004 (Phase 2C).
 *
 * Runs the appropriate package's unit + integration test commands
 * against the worker's worktree after the Coding Agent finishes
 * implementation. The output is captured to disk and streamed back to
 * the implementation engine in summary form.
 *
 * Command discovery rules:
 *   1. If `<repo>/docs/test-commands.md` exists, parse it for the
 *      `## unit` and `## integration` shell-fenced blocks.
 *   2. Otherwise, scope `pnpm test --filter` by inspecting the diff for
 *      touched package paths.
 *   3. As a final fallback, run `pnpm test` at the repo root.
 *
 * @owner coding-agent (Phase 2C worker track)
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, type SpawnSyncOptions } from 'child_process';
import type { Worktree } from './worktree-manager';
import type { Bundle } from './bundle-reader';
import * as codingMetrics from './coding-metrics';

// ─── Types ──────────────────────────────────────────────────────────────────

export type TestPhase = 'unit' | 'integration';

export interface TestPhaseResult {
  phase: TestPhase;
  command: string;
  exitCode: number;
  durationMs: number;
  stdoutTail: string;       // last ~5 KiB of stdout — keeps memory bounded
  stderrTail: string;
  passed: boolean;
}

export interface RunResult {
  results: TestPhaseResult[];
  /** Combined pass: every executed phase exited 0. */
  passed: boolean;
  /** Total wallclock across phases. */
  totalDurationMs: number;
  /** Path to the on-disk log file (full output, not just the tail). */
  logPath: string;
}

export interface RunnerOptions {
  /** Override exec (tests). */
  execImpl?: typeof spawnSync;
  /** Override fs (tests). */
  fsImpl?: Pick<typeof fs, 'existsSync' | 'readFileSync' | 'writeFileSync' | 'mkdirSync'>;
  /** Override clock (tests). */
  now?: () => number;
  /** Override default tail size (bytes). */
  tailBytes?: number;
}

const DEFAULT_TAIL_BYTES = 5 * 1024;

// ─── Class ──────────────────────────────────────────────────────────────────

export class LocalTestRunner {
  private readonly exec: typeof spawnSync;
  private readonly fs: Pick<typeof fs, 'existsSync' | 'readFileSync' | 'writeFileSync' | 'mkdirSync'>;
  private readonly now: () => number;
  private readonly tailBytes: number;

  constructor(opts: RunnerOptions = {}) {
    this.exec = opts.execImpl ?? spawnSync;
    this.fs = opts.fsImpl ?? fs;
    this.now = opts.now ?? Date.now;
    this.tailBytes = opts.tailBytes ?? DEFAULT_TAIL_BYTES;
  }

  // ─── Public ───────────────────────────────────────────────────────────────

  /**
   * Discovers + runs the test commands. Always writes a log file to
   * `<worktree.path>/.test-output.log` (overwriting prior runs). Returns
   * a structured per-phase summary.
   */
  run(worktree: Worktree, bundle: Bundle): RunResult {
    const logPath = path.join(worktree.path, '.test-output.log');
    const phases = this.discoverCommands(worktree.path, bundle);
    const results: TestPhaseResult[] = [];
    const start = this.now();
    const logBuf: string[] = [];
    for (const [phase, command] of phases) {
      const phaseStart = this.now();
      const res = this.exec('bash', ['-c', command], {
        cwd: worktree.path,
        encoding: 'utf8',
        timeout: 600_000,
        env: process.env,
      } as SpawnSyncOptions);
      const stdout = String(res.stdout ?? '');
      const stderr = String(res.stderr ?? '');
      const exitCode = res.status ?? -1;
      logBuf.push(
        `=== ${phase} (exit=${exitCode}) ===`,
        `$ ${command}`,
        '',
        '--- stdout ---',
        stdout,
        '--- stderr ---',
        stderr,
        '',
      );
      const phaseDurationMs = this.now() - phaseStart;
      const passed = exitCode === 0;
      results.push({
        phase,
        command,
        exitCode,
        durationMs: phaseDurationMs,
        stdoutTail: this.tail(stdout),
        stderrTail: this.tail(stderr),
        passed,
      });
      codingMetrics.testRunsTotal.inc({ phase, outcome: passed ? 'passed' : 'failed' });
      codingMetrics.testDurationMs.observe({ phase }, phaseDurationMs);
      // Bail out after a failure to save time — fix-loop will retry.
      if (!passed) break;
    }
    this.writeLog(logPath, logBuf.join('\n'));
    return {
      results,
      passed: results.length > 0 && results.every((r) => r.passed),
      totalDurationMs: this.now() - start,
      logPath,
    };
  }

  // ─── Discovery ────────────────────────────────────────────────────────────

  /**
   * Returns an ordered list of [phase, command] pairs to execute. Public
   * for testability.
   */
  discoverCommands(worktreePath: string, bundle: Bundle): Array<[TestPhase, string]> {
    // 1. test-commands.md
    const docPath = path.join(worktreePath, 'docs', 'test-commands.md');
    if (this.fs.existsSync(docPath)) {
      const md = String(this.fs.readFileSync(docPath));
      const unit = this.extractFenceUnder(md, 'unit');
      const integration = this.extractFenceUnder(md, 'integration');
      const out: Array<[TestPhase, string]> = [];
      if (unit) out.push(['unit', unit]);
      if (integration) out.push(['integration', integration]);
      if (out.length > 0) return out;
    }

    // 2. Inspect bundle.story claims for touched package paths.
    const claimsFiles = this.extractClaimFiles(bundle);
    const packages = this.derivePackagesFromFiles(claimsFiles);
    if (packages.size > 0) {
      const filterArgs = [...packages].map((p) => `--filter ${p}`).join(' ');
      return [['unit', `pnpm ${filterArgs} test`]];
    }

    // 3. Fallback to repo-wide.
    return [['unit', 'pnpm -w test']];
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private extractFenceUnder(md: string, heading: string): string | null {
    // Match `## <heading>\n\n```...\n<cmd>\n```
    const re = new RegExp(`^##\\s+${heading}\\s*$\\s*\`\`\`(?:\\w+)?\\s*([\\s\\S]*?)\\s*\`\`\``, 'mi');
    const m = re.exec(md);
    if (!m) return null;
    const cmd = m[1]?.trim();
    return cmd && cmd.length > 0 ? cmd : null;
  }

  private extractClaimFiles(bundle: Bundle): string[] {
    const ticket = (bundle.ticket ?? {}) as Record<string, unknown>;
    const claims = (ticket.claims ?? {}) as Record<string, unknown>;
    const files = claims.files;
    if (!Array.isArray(files)) return [];
    return files.filter((f): f is string => typeof f === 'string');
  }

  /**
   * Heuristic: a file under `apps/<name>/...` belongs to package `@caia-app/<name>`
   * (matching the workspace convention). A file under `packages/<name>/...`
   * belongs to `@chiefaia/<name>`. Other paths are skipped.
   */
  private derivePackagesFromFiles(files: string[]): Set<string> {
    const out = new Set<string>();
    for (const f of files) {
      const norm = f.replace(/^\.\//, '');
      const m1 = /^apps\/([^/]+)\//.exec(norm);
      if (m1) {
        out.add(`@caia-app/${m1[1]}`);
        continue;
      }
      const m2 = /^packages\/([^/]+)\//.exec(norm);
      if (m2) {
        out.add(`@chiefaia/${m2[1]}`);
      }
    }
    return out;
  }

  private tail(s: string): string {
    if (Buffer.byteLength(s, 'utf8') <= this.tailBytes) return s;
    return '...[truncated]...\n' + s.slice(-this.tailBytes);
  }

  private writeLog(filePath: string, contents: string): void {
    const dir = path.dirname(filePath);
    try {
      this.fs.mkdirSync(dir, { recursive: true });
    } catch {
      /* dir may already exist */
    }
    this.fs.writeFileSync(filePath, contents);
  }
}
