import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Tests cover the consumption-probe.js bin script end-to-end. We build a
// tiny fixture monorepo (3 packages, 1 launchd plist, 1 importer) under a
// scratch dir, invoke the script with that dir as cwd, and assert it
// classifies LIVE vs DORMANT correctly.

const PROBE_BIN = join(__dirname, '..', 'bin', 'consumption-probe.js');

function makePkg(root: string, slug: string, body: { name: string; bin?: Record<string, string>; description?: string }): void {
  const dir = join(root, 'packages', slug);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(body, null, 2));
  writeFileSync(join(dir, 'src', 'index.ts'), `export const NAME = '${body.name}';\n`);
}

function gitInit(root: string): void {
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: root });
}

interface Fixture {
  root: string;
  cleanup: () => void;
}

function setupFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'caia-probe-'));
  // Marker required for repo-root walk-up.
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');

  // Pkg A — has importer in pkg-b's index.ts → LIVE.
  makePkg(root, 'pkg-a', { name: '@chiefaia/pkg-a', description: 'a-purpose' });
  // Pkg B — imports pkg-a; itself has zero importers → DORMANT.
  makePkg(root, 'pkg-b', { name: '@chiefaia/pkg-b', description: 'b-purpose' });
  writeFileSync(
    join(root, 'packages', 'pkg-b', 'src', 'index.ts'),
    "import { NAME } from '@chiefaia/pkg-a';\nexport { NAME };\n",
  );
  // Pkg C — has bin and a dummy plist that points at packages/pkg-c/dist/cli.js → LIVE.
  makePkg(root, 'pkg-c', {
    name: '@chiefaia/pkg-c',
    bin: { 'caia-pkg-c': './dist/cli.js' },
    description: 'c-purpose',
  });
  // Pkg D — orphan, no importer, no plist → DORMANT.
  makePkg(root, 'pkg-d', { name: '@chiefaia/pkg-d', description: 'd-purpose' });

  // Inline a fake "plist" by setting HOME to a sandbox with LaunchAgents/.
  // The probe scans $HOME/Library/LaunchAgents, so we redirect HOME instead
  // of polluting the real one.
  const fakeHome = join(root, '.home');
  mkdirSync(join(fakeHome, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(
    join(fakeHome, 'Library', 'LaunchAgents', 'com.test.pkg-c.plist'),
    `<?xml version="1.0"?><plist><dict><key>ProgramArguments</key><array><string>/usr/bin/node</string><string>${root}/packages/pkg-c/dist/cli.js</string></array></dict></plist>`,
  );

  gitInit(root);

  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runProbe(root: string, args: string[] = []): { status: number; stdout: string; stderr: string } {
  const fakeHome = join(root, '.home');
  try {
    const stdout = execFileSync(process.execPath, [PROBE_BIN, ...args], {
      cwd: root,
      // CAIA_PROBE_REPO_ROOT pins the probe to the test fixture so it
      // doesn't accidentally scan the surrounding caia worktree (the bin
      // also walks up from cwd, but the env override is more deterministic
      // when tests run inside the caia repo itself).
      env: { ...process.env, HOME: fakeHome, CAIA_PROBE_REPO_ROOT: root },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      status: err.status ?? 1,
      stdout: err.stdout?.toString('utf8') ?? '',
      stderr: err.stderr?.toString('utf8') ?? '',
    };
  }
}

describe('consumption-probe.js', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = setupFixture();
  });

  afterEach(() => {
    fx.cleanup();
  });

  it('flags pkg-b and pkg-d as DORMANT, pkg-a + pkg-c as LIVE', () => {
    const { status, stdout } = runProbe(fx.root, ['--dry-run']);
    expect(status).toBe(0);
    expect(stdout).toContain('dormant_count: 2');
    // The dry-run line lists *newly_dormant* names since prior DORMANT_PACKAGES.md
    // is missing — so both pkg-b and pkg-d should appear. pkg-a (importer of
    // pkg-b uses it ↦ LIVE) and pkg-c (plist consumer) must NOT appear.
    expect(stdout).toContain('@chiefaia/pkg-b');
    expect(stdout).toContain('@chiefaia/pkg-d');
    expect(stdout).not.toContain('@chiefaia/pkg-a,');
    expect(stdout).not.toContain('@chiefaia/pkg-c,');
  });

  it('--pkg <slug> prints JSON detail with importers + plist consumers', () => {
    const { status, stdout } = runProbe(fx.root, ['--pkg', 'pkg-a']);
    expect(status).toBe(0);
    const data = JSON.parse(stdout) as { name: string; status: string; importers: string[] };
    expect(data.name).toBe('@chiefaia/pkg-a');
    expect(data.status).toBe('LIVE');
    expect(data.importers.some((p) => p.includes('pkg-b'))).toBe(true);
  });

  it('writes DORMANT_PACKAGES.md and reports/consumption_probe_<date>.md on a real run', () => {
    const { status } = runProbe(fx.root, []);
    expect(status).toBe(0);
    const dormantMd = readFileSync(join(fx.root, 'docs', 'DORMANT_PACKAGES.md'), 'utf8');
    expect(dormantMd).toContain('# Dormant packages');
    expect(dormantMd).toContain('@chiefaia/pkg-b');
    expect(dormantMd).toContain('@chiefaia/pkg-d');
    expect(dormantMd).not.toContain('| `@chiefaia/pkg-a` |');
    const today = new Date().toISOString().slice(0, 10);
    const probeMd = readFileSync(join(fx.root, 'reports', `consumption_probe_${today}.md`), 'utf8');
    expect(probeMd).toContain('Consumption probe — ');
    expect(probeMd).toMatch(/DORMANT: 2/);
  });

  it('detects drift: pkg revived → noted under "revived since last probe"', () => {
    // First run: pkg-d is dormant.
    runProbe(fx.root, []);
    // Wire pkg-d as a dep of pkg-a → should now be LIVE.
    const pkgAJson = JSON.parse(readFileSync(join(fx.root, 'packages', 'pkg-a', 'package.json'), 'utf8')) as {
      name: string;
      dependencies?: Record<string, string>;
    };
    pkgAJson.dependencies = { '@chiefaia/pkg-d': 'workspace:*' };
    writeFileSync(join(fx.root, 'packages', 'pkg-a', 'package.json'), JSON.stringify(pkgAJson, null, 2));
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-aq', '-m', 'wire pkg-d'], {
      cwd: fx.root,
    });
    // Second run: pkg-d should be revived.
    const { status, stdout } = runProbe(fx.root, []);
    expect(status).toBe(0);
    expect(stdout).toContain('revived: @chiefaia/pkg-d');
    const today = new Date().toISOString().slice(0, 10);
    const probeMd = readFileSync(join(fx.root, 'reports', `consumption_probe_${today}.md`), 'utf8');
    expect(probeMd).toContain('Drift — revived since last probe');
    expect(probeMd).toContain('@chiefaia/pkg-d');
  });

  it('exits 0 when scanning a one-package repo with zero dormants', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-probe-empty-'));
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n');
    makePkg(root, 'only-pkg', { name: '@chiefaia/only-pkg' });
    // Only-pkg has no importer → it's dormant — but the probe should still
    // exit 0 (dormant is the normal output, not an error).
    gitInit(root);
    const { status } = runProbe(root, ['--dry-run']);
    expect(status).toBe(0);
    rmSync(root, { recursive: true, force: true });
  });
});
