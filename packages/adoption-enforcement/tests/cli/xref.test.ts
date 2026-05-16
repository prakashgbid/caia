// End-to-end smoke test for `caia-adoption-run xref`.
//
// Builds a synthetic monorepo + a synthetic scan.json that names the three
// concrete adoption examples from the design doc (§1.5):
//   - @chiefaia/guardrails-validator/scanPii
//   - @chiefaia/tracing/Tracer
//   - @chiefaia/system-prompt-block/generateCaiaPrimer
// Runs xref, asserts each artefact finds at least one candidate at the
// expected adoption site (per design doc §5), then re-runs to verify
// idempotency and --force behaviour.

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runXref, runXrefCli, type XrefReport } from '../../src/cli/xref.js';

// ---------------------------------------------------------------------------
// Fixture helpers — write a tmp git repo + a work dir holding scan.json.
// ---------------------------------------------------------------------------

interface FixtureFile {
  path: string;
  content: string;
}

function mkRepo(files: ReadonlyArray<FixtureFile>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-xref-cli-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  for (const f of files) {
    const abs = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content, 'utf8');
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  return dir;
}

function rmDir(d: string): void {
  fs.rmSync(d, { recursive: true, force: true });
}

// Three concrete examples from the design doc §1.5 — exporter package + the
// site where an adoption PR should be generated.
function designDocFixture(): FixtureFile[] {
  return [
    // ── @chiefaia/guardrails-validator → scanPii ────────────────────────────
    {
      path: 'packages/guardrails-validator/package.json',
      content: JSON.stringify({ name: '@chiefaia/guardrails-validator', version: '0.1.0' }) + '\n',
    },
    {
      path: 'packages/guardrails-validator/src/index.ts',
      content: 'export function scanPii(input: string): string { return input; }\n',
    },
    {
      path: 'apps/orchestrator/src/safety/tool-result-sanitizer-bridge.ts',
      content:
        "// Custom PII/secret/injection scanning duplicated here; should call @chiefaia/guardrails-validator.scanPii.\n" +
        "export function sanitizeToolResult(text: string): string {\n" +
        "  // TODO: replace this hand-rolled regex with scanPii from the validator package.\n" +
        "  return text.replace(/\\b\\d{3}-\\d{2}-\\d{4}\\b/g, '[ssn-redacted]');\n" +
        "}\n",
    },

    // ── @chiefaia/tracing → Tracer ──────────────────────────────────────────
    {
      path: 'packages/tracing/package.json',
      content: JSON.stringify({ name: '@chiefaia/tracing', version: '0.1.0' }) + '\n',
    },
    {
      path: 'packages/tracing/src/index.ts',
      content: 'export class Tracer { startSpan(_name: string): void {} }\n',
    },
    {
      path: 'apps/orchestrator/src/observability/agent-otel.ts',
      content:
        "import { trace } from '@opentelemetry/api';\n" +
        "// FIXME: switch to @chiefaia/tracing.Tracer wrapper once the helper is stable.\n" +
        "export function startAgentSpan(name: string): void {\n" +
        "  const tracer = trace.getTracer('agent');\n" +
        "  tracer.startSpan(name).end();\n" +
        "}\n",
    },

    // ── @chiefaia/system-prompt-block → generateCaiaPrimer ──────────────────
    {
      path: 'packages/system-prompt-block/package.json',
      content: JSON.stringify({ name: '@chiefaia/system-prompt-block', version: '0.1.0' }) + '\n',
    },
    {
      path: 'packages/system-prompt-block/src/index.ts',
      content: 'export function generateCaiaPrimer(): string { return ""; }\n',
    },
    {
      path: 'apps/orchestrator/src/api/routes/agents.ts',
      content:
        "// TODO: prepend generateCaiaPrimer() output instead of hand-built block.\n" +
        "export const systemPrompt = 'You are an agent. Follow CAIA rules...';\n",
    },
    {
      path: 'apps/worker-coding/src/implementation-engine.ts',
      content:
        "// generateCaiaPrimer is not yet wired into worker-coding's system prompt.\n" +
        "export const systemPrompt = 'You are a coder. Implement the spec...';\n",
    },
  ];
}

function writeScanJson(workDir: string, sha: string): void {
  const scan = {
    sha,
    artefacts: [
      {
        kind: 'new_export',
        package: '@chiefaia/guardrails-validator',
        identifier: 'scanPii',
        decl_kind: 'function',
        file: 'packages/guardrails-validator/src/index.ts',
      },
      {
        kind: 'new_export',
        package: '@chiefaia/tracing',
        identifier: 'Tracer',
        decl_kind: 'class',
        file: 'packages/tracing/src/index.ts',
      },
      {
        kind: 'new_export',
        package: '@chiefaia/system-prompt-block',
        identifier: 'generateCaiaPrimer',
        decl_kind: 'function',
        file: 'packages/system-prompt-block/src/index.ts',
      },
    ],
  };
  fs.writeFileSync(path.join(workDir, 'scan.json'), JSON.stringify(scan, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runXref — end-to-end against design-doc §1.5 examples', () => {
  const trash: string[] = [];
  afterEach(() => {
    while (trash.length) {
      const d = trash.pop();
      if (d) rmDir(d);
    }
  });

  function setup(): { repoRoot: string; workDir: string } {
    const repoRoot = mkRepo(designDocFixture());
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-xref-work-'));
    trash.push(repoRoot, workDir);
    writeScanJson(workDir, 'deadbeefcafe');
    return { repoRoot, workDir };
  }

  it('finds at least one candidate per design-doc artefact at the expected file', () => {
    const { repoRoot, workDir } = setup();

    const result = runXref({ workDir, repoRoot });

    expect(result.written).toBe(true);
    expect(result.outPath).toBe(path.join(workDir, 'xref.json'));
    expect(fs.existsSync(result.outPath)).toBe(true);

    const report = result.report;
    expect(report.version).toBe(1);
    expect(report.sha).toBe('deadbeefcafe');
    expect(report.summary.artefact_count).toBe(3);

    const byIdent = new Map(report.artefacts.map((a) => [a.artefact.identifier, a]));

    // ── scanPii ──
    const scanPii = byIdent.get('scanPii');
    expect(scanPii, 'expected an artefact entry for scanPii').toBeDefined();
    const scanPiiFiles = scanPii!.candidates.map((c) => c.file);
    expect(scanPiiFiles.length).toBeGreaterThanOrEqual(1);
    expect(scanPiiFiles).toContain(
      'apps/orchestrator/src/safety/tool-result-sanitizer-bridge.ts',
    );
    expect(scanPii!.candidates.every((c) => c.confidence === 'literal')).toBe(true);
    expect(scanPii!.scoring.score).toBeGreaterThan(0);

    // ── Tracer ──
    const tracer = byIdent.get('Tracer');
    expect(tracer, 'expected an artefact entry for Tracer').toBeDefined();
    const tracerFiles = tracer!.candidates.map((c) => c.file);
    expect(tracerFiles.length).toBeGreaterThanOrEqual(1);
    expect(tracerFiles).toContain(
      'apps/orchestrator/src/observability/agent-otel.ts',
    );

    // ── generateCaiaPrimer ──
    const primer = byIdent.get('generateCaiaPrimer');
    expect(primer, 'expected an artefact entry for generateCaiaPrimer').toBeDefined();
    const primerFiles = primer!.candidates.map((c) => c.file);
    expect(primerFiles.length).toBeGreaterThanOrEqual(1);
    expect(primerFiles).toContain('apps/orchestrator/src/api/routes/agents.ts');
    // Two candidates land in the orchestrator's prompt sites.
    expect(primerFiles).toContain('apps/worker-coding/src/implementation-engine.ts');

    // Own-package hits must be excluded across every artefact.
    for (const a of report.artefacts) {
      for (const c of a.candidates) {
        expect(c.file.startsWith('packages/')).toBe(false);
      }
    }
  });

  it('is idempotent: a second run without --force skips work and returns the existing report', () => {
    const { repoRoot, workDir } = setup();

    const first = runXref({ workDir, repoRoot });
    expect(first.written).toBe(true);

    // Mutate the existing xref.json so we can prove the second call returned
    // it untouched instead of overwriting.
    const sentinel: XrefReport = {
      ...first.report,
      sha: 'sentinel-not-overwritten',
    };
    fs.writeFileSync(first.outPath, JSON.stringify(sentinel, null, 2) + '\n', 'utf8');

    const second = runXref({ workDir, repoRoot });
    expect(second.written).toBe(false);
    expect(second.report.sha).toBe('sentinel-not-overwritten');
  });

  it('overwrites the existing xref.json when --force is set', () => {
    const { repoRoot, workDir } = setup();

    runXref({ workDir, repoRoot });
    fs.writeFileSync(
      path.join(workDir, 'xref.json'),
      JSON.stringify({ sentinel: true }, null, 2) + '\n',
      'utf8',
    );

    const forced = runXref({ workDir, repoRoot, force: true });
    expect(forced.written).toBe(true);
    expect(forced.report.summary.artefact_count).toBe(3);
  });

  it('respects --max-candidates: capping to 1 leaves each artefact with at most one candidate', () => {
    const { repoRoot, workDir } = setup();

    const result = runXref({ workDir, repoRoot, maxCandidates: 1 });

    for (const a of result.report.artefacts) {
      expect(a.candidates.length).toBeLessThanOrEqual(1);
      // generateCaiaPrimer originally has two candidates → one must be truncated.
      if (a.artefact.identifier === 'generateCaiaPrimer') {
        expect(a.truncated).toBeGreaterThanOrEqual(1);
      }
    }
    expect(result.report.options.maxCandidates).toBe(1);
  });

  it('emits an empty report (no artefacts) when scan.json has zero rows', () => {
    const repoRoot = mkRepo([{ path: 'README.md', content: 'noop\n' }]);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-xref-empty-'));
    trash.push(repoRoot, workDir);
    fs.writeFileSync(
      path.join(workDir, 'scan.json'),
      JSON.stringify({ sha: 'noop', artefacts: [] }, null, 2) + '\n',
      'utf8',
    );

    const result = runXref({ workDir, repoRoot });
    expect(result.report.summary.artefact_count).toBe(0);
    expect(result.report.summary.candidate_count).toBe(0);
    expect(result.report.artefacts).toEqual([]);
  });

  it('accepts a bare-array scan.json shape', () => {
    const { repoRoot } = setup();
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-xref-arr-'));
    trash.push(workDir);
    const arr = [
      {
        kind: 'new_export',
        package: '@chiefaia/guardrails-validator',
        identifier: 'scanPii',
        file: 'packages/guardrails-validator/src/index.ts',
      },
    ];
    fs.writeFileSync(path.join(workDir, 'scan.json'), JSON.stringify(arr) + '\n', 'utf8');
    const result = runXref({ workDir, repoRoot });
    expect(result.report.summary.artefact_count).toBe(1);
    expect(result.report.sha).toBeNull();
  });

  it('throws when scan.json is missing', () => {
    const repoRoot = mkRepo([{ path: 'README.md', content: 'noop\n' }]);
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-xref-missing-'));
    trash.push(repoRoot, workDir);
    expect(() => runXref({ workDir, repoRoot })).toThrowError(/scan\.json not found/);
  });

  it('throws when work-dir does not exist', () => {
    const bogus = path.join(os.tmpdir(), 'adopt-xref-does-not-exist-' + Date.now());
    expect(() => runXref({ workDir: bogus })).toThrowError(/--work-dir/);
  });
});

describe('runXrefCli — argument parsing + exit codes', () => {
  const trash: string[] = [];
  afterEach(() => {
    while (trash.length) {
      const d = trash.pop();
      if (d) rmDir(d);
    }
  });

  it('runs end-to-end through the CLI surface and exits 0', () => {
    const repoRoot = mkRepo(designDocFixture());
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-xref-cli-run-'));
    trash.push(repoRoot, workDir);
    writeScanJson(workDir, 'cli-sha');

    const result = runXrefCli(['--work-dir', workDir, '--repo', repoRoot]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('artefacts=3');
    expect(fs.existsSync(path.join(workDir, 'xref.json'))).toBe(true);

    // Second invocation hits the idempotent skip path.
    const second = runXrefCli(['--work-dir', workDir, '--repo', repoRoot]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain('skipped');
  });

  it('returns exit-code 2 with help text on missing --work-dir', () => {
    const result = runXrefCli([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--work-dir');
  });

  it('returns exit-code 2 on unknown flag', () => {
    const result = runXrefCli(['--what']);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown arg');
  });

  it('returns exit-code 0 for --help', () => {
    const result = runXrefCli(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('caia-adoption-run xref');
  });

  it('returns exit-code 1 when scan.json is missing', () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adopt-xref-cli-missing-'));
    trash.push(workDir);
    const result = runXrefCli(['--work-dir', workDir]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('scan.json not found');
  });
});
