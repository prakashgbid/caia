import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  doctorExitCode,
  formatDoctorReport,
  lastPhaseDoneTs,
  parseDfOutput,
  parseLaunchctlPrint,
  readChainHealth,
  readChainWakes,
  runDoctor,
  scanQuotaWarnings,
  summariseChainHealth,
  type DoctorReport,
} from '../src/doctor.js';

describe('parseLaunchctlPrint', () => {
  it('extracts state + last exit status from a typical launchctl print dump', () => {
    const raw = [
      'com.caia.mentor.server = {',
      '\ttype = LaunchAgent',
      '\tstate = running',
      '\tprogram = /opt/homebrew/opt/node@22/bin/node',
      '\tlast exit code = 0',
      '\tpid = 12345',
      '}',
    ].join('\n');
    const parsed = parseLaunchctlPrint(raw);
    expect(parsed.state).toBe('running');
    expect(parsed.lastExitStatus).toBe(0);
  });

  it('handles "last exit status = -1" (signalled exit)', () => {
    const raw = ['\tstate = waiting', '\tlast exit status = -1'].join('\n');
    expect(parseLaunchctlPrint(raw).lastExitStatus).toBe(-1);
  });

  it('returns nulls for empty output (unloaded service)', () => {
    expect(parseLaunchctlPrint('')).toEqual({
      state: null,
      lastExitStatus: null,
    });
  });
});

describe('readChainWakes', () => {
  it('returns one entry per chain, sorted by chain id', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-'));
    const chainRoot = join(root, 'chain');
    mkdirSync(join(chainRoot, 'zeta'), { recursive: true });
    mkdirSync(join(chainRoot, 'alpha'), { recursive: true });
    writeFileSync(
      join(chainRoot, 'alpha', 'state.json'),
      JSON.stringify({
        last_wake: '2026-05-14T01:00:00Z',
        current_phase: 3,
        paused: false,
        all_done: false,
      }),
    );
    writeFileSync(
      join(chainRoot, 'zeta', 'state.json'),
      JSON.stringify({
        last_wake: null,
        current_phase: null,
        paused: false,
        all_done: true,
      }),
    );
    const wakes = readChainWakes(chainRoot);
    expect(wakes.map((w) => w.chainId)).toEqual(['alpha', 'zeta']);
    expect(wakes[0]?.lastWake).toBe('2026-05-14T01:00:00Z');
    expect(wakes[0]?.currentPhase).toBe(3);
    expect(wakes[1]?.allDone).toBe(true);
  });

  it('returns [] when chain root does not exist', () => {
    expect(readChainWakes(join(tmpdir(), 'definitely-not-real-xyz'))).toEqual([]);
  });

  it('skips directories with no state.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-empty-'));
    const chainRoot = join(root, 'chain');
    mkdirSync(join(chainRoot, 'empty-chain'), { recursive: true });
    expect(readChainWakes(chainRoot)).toEqual([]);
  });
});

describe('formatDoctorReport', () => {
  it('renders all four sections in order', () => {
    const r: DoctorReport = {
      nodeVersion: 'v22.22.2',
      nodeBin: '/opt/homebrew/opt/node@22/bin/node',
      healthz: [
        {
          name: 'mentor',
          url: 'http://127.0.0.1:5180/v1/healthz',
          ok: true,
          status: 200,
          error: null,
          elapsedMs: 12,
        },
        {
          name: 'router',
          url: 'http://127.0.0.1:7411/healthz',
          ok: false,
          status: null,
          error: 'ECONNREFUSED',
          elapsedMs: 5,
        },
      ],
      plists: [
        {
          label: 'com.caia.mentor.server',
          loaded: true,
          state: 'running',
          lastExitStatus: 0,
          raw: '',
        },
      ],
      chains: [
        {
          chainId: 'redflag-remediation',
          lastWake: '2026-05-14T00:00:00Z',
          currentPhase: 3,
          paused: false,
          allDone: false,
        },
      ],
    };
    const out = formatDoctorReport(r);
    expect(out).toMatch(/# node/);
    expect(out).toMatch(/v22\.22\.2/);
    expect(out).toMatch(/# healthz/);
    expect(out).toMatch(/mentor.*OK/);
    expect(out).toMatch(/router.*FAIL/);
    expect(out).toMatch(/ECONNREFUSED/);
    expect(out).toMatch(/# launchd plists/);
    expect(out).toMatch(/com\.caia\.mentor\.server/);
    expect(out).toMatch(/# chains/);
    expect(out).toMatch(/redflag-remediation/);
  });
});

// =============================================================================
// V2 sections (H-7, chain-runner-battle-harden phase 6, 2026-05-14)
// =============================================================================

describe('summariseChainHealth', () => {
  it('rolls up phase counts and marks stalled when streak >= threshold', () => {
    const h = summariseChainHealth(
      'test',
      {
        schema_version: 1,
        started_at: '2026-05-14T00:00:00Z',
        last_wake: null,
        paused: false,
        budget_consumed_pct: 0,
        budget_cap_pct: 25,
        phase_status: {
          '1': { status: 'done' } as never,
          '2': { status: 'done' } as never,
          '3': { status: 'pending' } as never,
          '4': { status: 'blocked' } as never,
        },
        current_phase: null,
        all_done: false,
        none_eligible_streak: 3,
      },
      null,
      null,
      '2026-05-14T00:30:00Z',
    );
    expect(h.counts).toEqual({ done: 2, pending: 1, blocked: 1 });
    expect(h.stalled).toBe(true);
    expect(h.lastPhaseDone).toBe('2026-05-14T00:30:00Z');
    expect(h.noneEligibleStreak).toBe(3);
  });

  it('marks stalled when lock age > 3 hours', () => {
    const now = 1_700_000_000_000;
    const fourHoursAgoMs = now - 4 * 3600 * 1000;
    const h = summariseChainHealth(
      'test',
      {
        schema_version: 1,
        started_at: '',
        last_wake: null,
        paused: false,
        budget_consumed_pct: 0,
        budget_cap_pct: 25,
        phase_status: {},
        current_phase: 1,
        all_done: false,
      },
      fourHoursAgoMs,
      1,
      null,
      now,
    );
    expect(h.stalled).toBe(true);
    expect(h.lockAgeSec).toBeGreaterThan(3 * 3600);
  });

  it('not stalled when streak < 2 and no lock', () => {
    const h = summariseChainHealth(
      'test',
      {
        schema_version: 1,
        started_at: '',
        last_wake: null,
        paused: false,
        budget_consumed_pct: 0,
        budget_cap_pct: 25,
        phase_status: { '1': { status: 'in_progress' } as never },
        current_phase: 1,
        all_done: false,
        none_eligible_streak: 1,
      },
      null,
      null,
      null,
    );
    expect(h.stalled).toBe(false);
  });
});

describe('lastPhaseDoneTs', () => {
  it('returns the most recent phase_done ts from an audit log', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-audit-'));
    const audit = join(root, 'audit.jsonl');
    writeFileSync(
      audit,
      [
        '{"ts":"2026-05-14T00:00:00Z","event":"phase_in_progress","phase_id":1}',
        '{"ts":"2026-05-14T00:10:00Z","event":"phase_done","phase_id":1}',
        '{"ts":"2026-05-14T00:20:00Z","event":"phase_in_progress","phase_id":2}',
        '{"ts":"2026-05-14T00:30:00Z","event":"phase_done","phase_id":2}',
        '',
      ].join('\n'),
    );
    expect(lastPhaseDoneTs(audit)).toBe('2026-05-14T00:30:00Z');
  });

  it('returns null when there is no phase_done event', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-audit-'));
    const audit = join(root, 'audit.jsonl');
    writeFileSync(audit, '{"ts":"2026-05-14T00:00:00Z","event":"wake"}\n');
    expect(lastPhaseDoneTs(audit)).toBeNull();
  });

  it('returns null for nonexistent files', () => {
    expect(lastPhaseDoneTs('/tmp/definitely-not-real-xyz.jsonl')).toBeNull();
  });
});

describe('readChainHealth', () => {
  it('rolls up health for each chain dir found under root', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-rch-'));
    mkdirSync(join(root, 'alpha'), { recursive: true });
    writeFileSync(
      join(root, 'alpha', 'state.json'),
      JSON.stringify({
        schema_version: 1,
        started_at: '',
        last_wake: null,
        paused: false,
        budget_consumed_pct: 0,
        budget_cap_pct: 25,
        phase_status: {
          '1': { status: 'done' },
          '2': { status: 'in_progress' },
        },
        current_phase: 2,
        all_done: false,
        none_eligible_streak: 0,
      }),
    );
    writeFileSync(
      join(root, 'alpha', 'audit.jsonl'),
      '{"ts":"2026-05-14T00:10:00Z","event":"phase_done","phase_id":1}\n',
    );
    const health = readChainHealth(root, Date.now());
    expect(health).toHaveLength(1);
    expect(health[0]?.chainId).toBe('alpha');
    expect(health[0]?.counts).toEqual({ done: 1, in_progress: 1 });
    expect(health[0]?.lastPhaseDone).toBe('2026-05-14T00:10:00Z');
    expect(health[0]?.stalled).toBe(false);
  });
});

describe('parseDfOutput', () => {
  it('parses macOS df -k output', () => {
    const raw = [
      'Filesystem    1024-blocks       Used  Available Capacity   iused      ifree %iused  Mounted on',
      '/dev/disk3s1   976490576    420000000  556490576     43%   123456    7654321    2%   /',
    ].join('\n');
    const r = parseDfOutput('/', raw);
    expect(r.availKb).toBe(556490576);
    expect(r.total).toBe(976490576);
    expect(r.ok).toBe(true);
  });

  it('marks ok=false when free space < 5 GB', () => {
    const raw = [
      'Filesystem    1024-blocks       Used  Available Capacity   Mounted on',
      '/dev/disk3s1   976490576    972000000   1000000     99%    /',
    ].join('\n');
    const r = parseDfOutput('/', raw);
    expect(r.availKb).toBeLessThan(5 * 1024 * 1024);
    expect(r.ok).toBe(false);
  });

  it('returns availKb=0 on malformed output', () => {
    expect(parseDfOutput('/', '')).toEqual({ mount: '/', availKb: 0, total: 0, ok: false });
  });
});

describe('scanQuotaWarnings', () => {
  it('returns a banner for a per-chain dispatch log with a rate-limit hit', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-quota-'));
    const chainRoot = join(root, 'chain');
    mkdirSync(join(chainRoot, 'alpha'), { recursive: true });
    writeFileSync(
      join(chainRoot, 'alpha', 'dispatch-1-sess.log'),
      "You've hit your limit. The limit resets May 16 at 12pm (America/New_York).\n",
    );
    const wakeLogs = join(root, 'chain-watchdog', 'logs');
    mkdirSync(wakeLogs, { recursive: true });
    const r = scanQuotaWarnings(chainRoot, Date.parse('2026-05-14T20:00:00Z'), wakeLogs);
    expect(r).toHaveLength(1);
    expect(r[0]?.chainId).toBe('alpha');
    expect(r[0]?.banner).toMatch(/May 16/);
  });

  it('returns [] when there are no recent banners', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-quota-empty-'));
    mkdirSync(join(root, 'chain'), { recursive: true });
    expect(scanQuotaWarnings(join(root, 'chain'), Date.now(), join(root, 'chain-watchdog', 'logs'))).toEqual([]);
  });

  it('sorts results by resetIso ascending', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-quota-sort-'));
    const chainRoot = join(root, 'chain');
    mkdirSync(join(chainRoot, 'a-later'), { recursive: true });
    mkdirSync(join(chainRoot, 'b-earlier'), { recursive: true });
    writeFileSync(
      join(chainRoot, 'a-later', 'dispatch-1-x.log'),
      "You've hit your limit. resets May 20 at 12pm (America/New_York)\n",
    );
    writeFileSync(
      join(chainRoot, 'b-earlier', 'dispatch-1-x.log'),
      "You've hit your limit. resets May 16 at 12pm (America/New_York)\n",
    );
    const r = scanQuotaWarnings(chainRoot, Date.parse('2026-05-14T20:00:00Z'), join(root, 'chain-watchdog', 'logs'));
    expect(r).toHaveLength(2);
    expect(r[0]?.chainId).toBe('b-earlier');
  });
});

describe('doctorExitCode', () => {
  function baseReport(): DoctorReport {
    return {
      nodeVersion: 'v22',
      nodeBin: '/bin/node',
      healthz: [{ name: 'm', url: 'u', ok: true, status: 200, error: null, elapsedMs: 1 }],
      plists: [],
      chains: [],
    };
  }
  it('returns 0 on a clean report', () => {
    expect(doctorExitCode(baseReport())).toBe(0);
  });
  it('returns 2 when any chainHealth.stalled === true', () => {
    const r = baseReport();
    r.chainHealth = [
      {
        chainId: 'x',
        counts: {},
        lockAgeSec: 0,
        lockedPhase: null,
        noneEligibleStreak: 5,
        lastPhaseDone: null,
        stalled: true,
        paused: false,
        pausedUntil: null,
      },
    ];
    expect(doctorExitCode(r)).toBe(2);
  });
  it('returns 1 on healthz failure', () => {
    const r = baseReport();
    r.healthz = [{ name: 'm', url: 'u', ok: false, status: null, error: 'down', elapsedMs: 1 }];
    expect(doctorExitCode(r)).toBe(1);
  });
  it('returns 1 on low disk', () => {
    const r = baseReport();
    r.disk = [{ mount: '/', availKb: 100, total: 1000, ok: false }];
    expect(doctorExitCode(r)).toBe(1);
  });
  it('returns 1 on auth preflight nonzero', () => {
    const r = baseReport();
    r.auth = {
      status: 'rate_limited',
      exit_code: 2,
      message: 'rate limit',
      elapsed_ms: 100,
      raw: '',
    };
    expect(doctorExitCode(r)).toBe(1);
  });
});

describe('runDoctor V2 — composes all sections with injected deps', () => {
  it('runs all sections + emits a full report', async () => {
    const chainRoot = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-v2-'));
    // Seed a chain dir so chainHealth/chains/quota all have something to find.
    mkdirSync(join(chainRoot, 'alpha'), { recursive: true });
    writeFileSync(
      join(chainRoot, 'alpha', 'state.json'),
      JSON.stringify({
        schema_version: 1,
        started_at: '',
        last_wake: '2026-05-14T00:00:00Z',
        paused: false,
        budget_consumed_pct: 0,
        budget_cap_pct: 25,
        phase_status: { '1': { status: 'done' } },
        current_phase: null,
        all_done: false,
        none_eligible_streak: 0,
      }),
    );
    const reapStub = vi.fn(async () => ({
      scannedAt: '2026-05-14T01:00:00Z',
      candidates: 0,
      suspects: 0,
      orphans: [],
      actions: [],
      dryRun: true,
    }));
    const preflightStub = vi.fn(async () => ({
      status: 'healthy' as const,
      exit_code: 0,
      message: 'ok',
      elapsed_ms: 100,
      raw: '',
    }));
    const diskStub = vi.fn((m: string) => ({ mount: m, availKb: 100 * 1024 * 1024, total: 1, ok: true }));
    const quotaStub = vi.fn(() => []);
    const report = await runDoctor({
      chainRoot,
      plistLabels: [],
      reapFn: reapStub,
      preflightFn: preflightStub,
      diskFn: diskStub,
      quotaFn: quotaStub,
      diskMounts: ['/', '/tmp'],
    });
    expect(report.chainHealth).toBeDefined();
    expect(report.orphans).toBeDefined();
    expect(report.disk?.length).toBe(2);
    expect(report.auth).toBeDefined();
    expect(report.quota).toEqual([]);
    expect(reapStub).toHaveBeenCalledWith({ dryRun: true });
    expect(preflightStub).toHaveBeenCalled();
  });

  it('legacyOnly=true emits only V1 sections (back-compat)', async () => {
    const chainRoot = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-legacy-'));
    const report = await runDoctor({
      chainRoot,
      plistLabels: [],
      legacyOnly: true,
    });
    expect(report.chainHealth).toBeUndefined();
    expect(report.orphans).toBeUndefined();
    expect(report.disk).toBeUndefined();
    expect(report.auth).toBeUndefined();
    expect(report.quota).toBeUndefined();
  });

  it('skipAuth=true does not spawn preflight', async () => {
    const chainRoot = mkdtempSync(join(tmpdir(), 'caia-cr-doctor-noauth-'));
    const preflightStub = vi.fn();
    const report = await runDoctor({
      chainRoot,
      plistLabels: [],
      skipAuth: true,
      preflightFn: preflightStub as never,
      reapFn: vi.fn(async () => ({
        scannedAt: '',
        candidates: 0,
        suspects: 0,
        orphans: [],
        actions: [],
        dryRun: true,
      })),
      diskFn: vi.fn(() => ({ mount: '/', availKb: 100 * 1024 * 1024, total: 1, ok: true })),
      quotaFn: vi.fn(() => []),
    });
    expect(preflightStub).not.toHaveBeenCalled();
    expect(report.auth).toEqual({ status: 'skipped', message: 'skipped via --skip-auth' });
  });
});

describe('formatDoctorReport — V2 sections (snapshot-style)', () => {
  it('renders chain-health / orphans / disk / auth / quota sections when populated', () => {
    const r: DoctorReport = {
      nodeVersion: 'v22.22.2',
      nodeBin: '/bin/node',
      healthz: [{ name: 'mentor', url: 'http://x', ok: true, status: 200, error: null, elapsedMs: 1 }],
      plists: [],
      chains: [],
      chainHealth: [
        {
          chainId: 'alpha',
          counts: { done: 1, in_progress: 1 },
          lockAgeSec: 60,
          lockedPhase: 2,
          noneEligibleStreak: 0,
          lastPhaseDone: '2026-05-14T00:30:00Z',
          stalled: false,
          paused: false,
          pausedUntil: null,
        },
      ],
      orphans: {
        scannedAt: '2026-05-14T01:00:00Z',
        candidates: 1,
        suspects: 1,
        orphans: [
          {
            pid: 300,
            ppid: 200,
            command: 'claude --print',
            ageSec: 600,
            chainId: 'alpha',
            phaseId: 1,
            runnerScript: '_chain_harden_run_phase.sh',
            phaseStatus: 'done',
            isOrphan: true,
          },
        ],
        actions: [],
        dryRun: true,
      },
      disk: [
        { mount: '/', availKb: 100 * 1024 * 1024, total: 200 * 1024 * 1024, ok: true },
        { mount: '/tmp', availKb: 1024, total: 1024 * 1024, ok: false },
      ],
      auth: {
        status: 'rate_limited',
        exit_code: 2,
        message: 'rate limit reset 12pm',
        elapsed_ms: 100,
        raw: '',
      },
      quota: [
        {
          chainId: 'alpha',
          logPath: '/path/dispatch-1.log',
          resetIso: '2026-05-16T16:00:00Z',
          banner: 'resets May 16 at 12pm',
          detectedAt: '2026-05-14T20:00:00Z',
        },
      ],
    };
    const out = formatDoctorReport(r);
    expect(out).toMatch(/# chain health/);
    expect(out).toMatch(/alpha.*done=1,in_progress=1/);
    expect(out).toMatch(/# orphans \(dry-run\)/);
    expect(out).toMatch(/candidates=1 suspects=1 orphans=1/);
    expect(out).toMatch(/# disk/);
    expect(out).toMatch(/\/tmp.*1024.*no/);
    expect(out).toMatch(/# auth/);
    expect(out).toMatch(/status=rate_limited exit=2/);
    expect(out).toMatch(/# quota/);
    expect(out).toMatch(/reset_iso=2026-05-16T16:00:00Z/);
  });
});
