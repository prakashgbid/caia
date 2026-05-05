/**
 * Per-scanner unit tests.
 *
 * Each scanner is tested in isolation with a mocked runShell + tmp
 * directories. No real shell commands are run.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dependabotCvesScanner } from '../src/scanners/dependabot-cves.js';
import { memoryDriftScanner } from '../src/scanners/memory-drift.js';
import { openPrAgeScanner } from '../src/scanners/open-pr-age.js';
import { staleTodosScanner } from '../src/scanners/stale-todos.js';
import { worktreeCountScanner } from '../src/scanners/worktree-count.js';
import { phase1Scanners } from '../src/scanners/index.js';
import type { ScanContext } from '../src/types.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'curator-scanners-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function mkCtx(
  overrides: Partial<ScanContext> = {},
  shellMock?: (cmd: string, args: string[]) => string
): ScanContext {
  return {
    repoRoot: tmp,
    memoryDir: join(tmp, 'memory'),
    reportsDir: join(tmp, 'reports'),
    runShell: shellMock ?? ((): string => ''),
    env: {},
    now: () => new Date('2026-05-05T01:00:00Z'),
    ...overrides
  };
}

describe('memoryDriftScanner', () => {
  it('returns a high-severity finding when memoryDir is missing', () => {
    const ctx = mkCtx({ memoryDir: join(tmp, 'does-not-exist') });
    const findings = memoryDriftScanner.scan(ctx) as ReturnType<
      typeof memoryDriftScanner.scan
    > extends Promise<infer T>
      ? T
      : ReturnType<typeof memoryDriftScanner.scan>;
    expect((findings as Array<{ severity: string }>).length).toBe(1);
    expect((findings as Array<{ severity: string; title: string }>)[0]?.severity).toBe('high');
    expect((findings as Array<{ severity: string; title: string }>)[0]?.title).toContain(
      'Memory directory missing'
    );
  });

  it('returns "MEMORY.md missing" when files exist but no index', () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    writeFileSync(join(memDir, 'a.md'), 'a');
    writeFileSync(join(memDir, 'b.md'), 'b');
    const ctx = mkCtx({ memoryDir: memDir });
    const findings = memoryDriftScanner.scan(ctx) as Array<{
      severity: string;
      title: string;
    }>;
    expect(findings[0]?.title).toContain('MEMORY.md index missing');
  });

  it('returns drift finding when on-disk count exceeds index', () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    for (let i = 0; i < 20; i++) writeFileSync(join(memDir, `f${i}.md`), '');
    writeFileSync(
      join(memDir, 'MEMORY.md'),
      `# Index\n- [a](f0.md)\n- [b](f1.md)\n- [c](f2.md)\n`
    );
    const ctx = mkCtx({ memoryDir: memDir });
    const findings = memoryDriftScanner.scan(ctx) as Array<{
      severity: string;
      title: string;
    }>;
    expect(findings[0]?.severity).toBe('high'); // drift = 17, ≥ 15 → high
    expect(findings[0]?.title).toContain('drift');
  });

  it('returns info finding when in sync', () => {
    const memDir = join(tmp, 'memory');
    mkdirSync(memDir);
    for (let i = 0; i < 3; i++) writeFileSync(join(memDir, `f${i}.md`), '');
    writeFileSync(
      join(memDir, 'MEMORY.md'),
      `# Index\n- [a](f0.md)\n- [b](f1.md)\n- [c](f2.md)\n`
    );
    const ctx = mkCtx({ memoryDir: memDir });
    const findings = memoryDriftScanner.scan(ctx) as Array<{
      severity: string;
    }>;
    expect(findings[0]?.severity).toBe('info');
  });
});

describe('staleTodosScanner', () => {
  it('reports info severity for low TODO counts', () => {
    const ctx = mkCtx({}, () => '5');
    const findings = staleTodosScanner.scan(ctx) as Array<{ severity: string; title: string }>;
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.title).toContain('5 TODO');
  });

  it('reports medium severity at 80+', () => {
    const ctx = mkCtx({}, () => '95');
    const findings = staleTodosScanner.scan(ctx) as Array<{ severity: string }>;
    expect(findings[0]?.severity).toBe('medium');
  });

  it('reports high severity at 200+', () => {
    const ctx = mkCtx({}, () => '500');
    const findings = staleTodosScanner.scan(ctx) as Array<{ severity: string }>;
    expect(findings[0]?.severity).toBe('high');
  });

  it('returns low-severity finding when grep errors', () => {
    const ctx = mkCtx({}, () => {
      throw new Error('grep failed');
    });
    const findings = staleTodosScanner.scan(ctx) as Array<{ severity: string; title: string }>;
    expect(findings[0]?.severity).toBe('low');
    expect(findings[0]?.title).toContain('errored');
  });
});

describe('openPrAgeScanner', () => {
  it('returns info when no PRs are open', () => {
    const ctx = mkCtx({}, () => '[]');
    const findings = openPrAgeScanner.scan(ctx) as Array<{ severity: string; title: string }>;
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.title).toContain('No stale');
  });

  it('flags PRs older than 7 days as medium', () => {
    const tenDaysAgo = new Date('2026-04-25T00:00:00Z').toISOString();
    const ctx = mkCtx({}, () =>
      JSON.stringify([
        { number: 1, title: 'old-ish PR', createdAt: tenDaysAgo }
      ])
    );
    const findings = openPrAgeScanner.scan(ctx) as Array<{ severity: string; title: string }>;
    expect(findings[0]?.severity).toBe('medium');
    expect(findings[0]?.title).toContain('older than 7');
  });

  it('flags PRs older than 30 days as high', () => {
    const fortyDaysAgo = new Date('2026-03-26T00:00:00Z').toISOString();
    const ctx = mkCtx({}, () =>
      JSON.stringify([
        { number: 9, title: 'very old PR', createdAt: fortyDaysAgo }
      ])
    );
    const findings = openPrAgeScanner.scan(ctx) as Array<{ severity: string }>;
    expect(findings.some((f) => f.severity === 'high')).toBe(true);
  });

  it('returns low when gh fails', () => {
    const ctx = mkCtx({}, () => {
      throw new Error('not auth');
    });
    const findings = openPrAgeScanner.scan(ctx) as Array<{ severity: string; title: string }>;
    expect(findings[0]?.severity).toBe('low');
    expect(findings[0]?.title).toContain('Could not query');
  });
});

describe('worktreeCountScanner', () => {
  it('returns info when below alarm', () => {
    const ctx = mkCtx({}, () => 'worktree /a\n\nworktree /b\n\nworktree /c\n');
    const findings = worktreeCountScanner.scan(ctx) as Array<{ severity: string; title: string }>;
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.title).toContain('3 active');
  });

  it('returns high when at alarm threshold (≥8)', () => {
    const lines = Array.from({ length: 9 }, (_, i) => `worktree /w${i}\n`).join('\n');
    const ctx = mkCtx({}, () => lines);
    const findings = worktreeCountScanner.scan(ctx) as Array<{ severity: string }>;
    expect(findings[0]?.severity).toBe('high');
  });

  it('returns critical when at hard-block threshold (≥12)', () => {
    const lines = Array.from({ length: 14 }, (_, i) => `worktree /w${i}\n`).join('\n');
    const ctx = mkCtx({}, () => lines);
    const findings = worktreeCountScanner.scan(ctx) as Array<{ severity: string }>;
    expect(findings[0]?.severity).toBe('critical');
  });

  it('returns low-severity finding when git fails', () => {
    const ctx = mkCtx({}, () => {
      throw new Error('not a git repo');
    });
    const findings = worktreeCountScanner.scan(ctx) as Array<{ severity: string }>;
    expect(findings[0]?.severity).toBe('low');
  });
});

describe('dependabotCvesScanner', () => {
  it('returns info when no open alerts', () => {
    const ctx = mkCtx({}, () => '[]');
    const findings = dependabotCvesScanner.scan(ctx) as Array<{ severity: string; title: string }>;
    expect(findings[0]?.severity).toBe('info');
    expect(findings[0]?.title).toContain('No open');
  });

  it('returns critical when there is at least one critical alert', () => {
    const alerts = [
      {
        number: 1,
        state: 'open',
        security_advisory: { severity: 'critical', summary: 'cri', cve_id: 'CVE-1' },
        dependency: { package: { name: 'lib-x' } }
      }
    ];
    const ctx = mkCtx({}, () => JSON.stringify(alerts));
    const findings = dependabotCvesScanner.scan(ctx) as Array<{ severity: string }>;
    expect(findings.some((f) => f.severity === 'critical')).toBe(true);
  });

  it('returns high for high-severity alerts', () => {
    const alerts = [
      {
        number: 2,
        state: 'open',
        security_advisory: { severity: 'high', summary: 'hi' }
      }
    ];
    const ctx = mkCtx({}, () => JSON.stringify(alerts));
    const findings = dependabotCvesScanner.scan(ctx) as Array<{ severity: string }>;
    expect(findings.some((f) => f.severity === 'high')).toBe(true);
  });

  it('handles paginated output by stitching arrays', () => {
    // gh --paginate concatenates JSON arrays with no separator
    const stitched =
      '[{"number":1,"state":"open","security_advisory":{"severity":"medium","summary":"m1"}}]' +
      '[{"number":2,"state":"open","security_advisory":{"severity":"low","summary":"l1"}}]';
    const ctx = mkCtx({}, () => stitched);
    const findings = dependabotCvesScanner.scan(ctx) as Array<{ severity: string; title: string }>;
    expect(findings.some((f) => f.title.includes('MED'))).toBe(true);
  });

  it('returns low when gh fails', () => {
    const ctx = mkCtx({}, () => {
      throw new Error('forbidden');
    });
    const findings = dependabotCvesScanner.scan(ctx) as Array<{ severity: string; title: string }>;
    expect(findings[0]?.severity).toBe('low');
  });
});

describe('phase1Scanners registry', () => {
  it('exposes 5 scanners', () => {
    expect(phase1Scanners.length).toBe(5);
  });

  it('every scanner has unique id + non-empty name', () => {
    const ids = phase1Scanners.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const sc of phase1Scanners) {
      expect(sc.id.length).toBeGreaterThan(0);
      expect(sc.name.length).toBeGreaterThan(0);
    }
  });
});
