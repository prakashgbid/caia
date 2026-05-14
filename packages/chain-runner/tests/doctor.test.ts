import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatDoctorReport,
  parseLaunchctlPrint,
  readChainWakes,
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
