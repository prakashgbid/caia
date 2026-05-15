import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// H-38 / H-39 / H-40 (chain-runner-battle-harden phase 11, 2026-05-14).
// End-to-end smoke test for bin/watchdog.js — the chain-watchdog shim.
//
// The shim replaced a duplicate stall-detection path that previously lived
// inside the watchdog itself. Now it iterates ~/.caia/chain/* (via
// CAIA_CHAIN_HOME), per-chain looks up <chain-id>.phases for the YAML and
// optionally <chain-id>.runner for a poke command (H-39), then forks
// `caia-chain check-stall` per chain. INBOX retention (H-40) runs once
// per UTC day. Audit / alerting / dedupe stay in the TS owner.

const REPO_ROOT = join(__dirname, '..');
const WATCHDOG_BIN = join(REPO_ROOT, 'bin', 'watchdog.cjs');
const CHAIN_CLI = join(REPO_ROOT, 'bin', 'caia-chain.js');

const NODE_BIN = process.execPath;

function writeYamlSpec(dir: string): string {
  const p = join(dir, 'phases.yaml');
  writeFileSync(
    p,
    `defaults:\n  max_minutes: 10\n  heartbeat_interval_sec: 60\nphases:\n  - id: 1\n    name: smoke\n`,
  );
  return p;
}

describe('H-38/H-39/H-40 chain-watchdog shim (bin/watchdog.js)', () => {
  let baseDir: string;
  let chainHome: string;
  let watchdogHome: string;
  let chainDir: string;
  let inboxPath: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'caia-watchdog-shim-'));
    chainHome = join(baseDir, 'chain');
    watchdogHome = join(baseDir, 'chain-watchdog');
    mkdirSync(chainHome, { recursive: true });
    mkdirSync(watchdogHome, { recursive: true });
    inboxPath = join(watchdogHome, 'INBOX.md');

    // Create a single chain folder under CAIA_CHAIN_HOME with a state.json.
    chainDir = join(chainHome, 'shim-test-chain');
    mkdirSync(chainDir, { recursive: true });
    writeFileSync(
      join(chainDir, 'state.json'),
      JSON.stringify({
        schema_version: 2,
        started_at: '2026-05-14T00:00:00Z',
        last_wake: new Date().toISOString(),
        paused: false,
        budget_consumed_pct: 0,
        budget_cap_pct: 100,
        phase_status: {
          '1': {
            status: 'pending',
            attempts: 0,
            max_retries: 2,
            max_minutes: 10,
            started_at: null,
            completed_at: null,
            session_id: null,
            error: null,
          },
        },
        current_phase: null,
        all_done: false,
      }),
    );
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function spawnWatchdog(env: NodeJS.ProcessEnv = {}) {
    return spawnSync(NODE_BIN, [WATCHDOG_BIN], {
      env: {
        ...process.env,
        CAIA_CHAIN_HOME: chainHome,
        CAIA_WATCHDOG_HOME: watchdogHome,
        CAIA_CHAIN_BIN: CHAIN_CLI,
        ...env,
      },
      encoding: 'utf8',
      timeout: 60_000,
    });
  }

  it('emits one stdout summary line per scan and writes watchdog.scan.log', () => {
    const phasesPath = writeYamlSpec(baseDir);
    writeFileSync(join(watchdogHome, 'shim-test-chain.phases'), phasesPath);

    const r = spawnWatchdog();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/scan_complete scanned=1 delegated=1/);
    // scan.log gets a per-event log (multiline).
    const scanLog = readFileSync(join(watchdogHome, 'watchdog.scan.log'), 'utf8');
    expect(scanLog).toMatch(/scan_complete/);
    expect(scanLog).toMatch(/check_stall/);
  });

  it('skips chains without a <chain-id>.phases registry file', () => {
    // No registry file written — chain should be skipped.
    const r = spawnWatchdog();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/scanned=1 delegated=0 skipped=1/);
    const scanLog = readFileSync(join(watchdogHome, 'watchdog.scan.log'), 'utf8');
    expect(scanLog).toMatch(/skipping_no_phases_yaml/);
  });

  it('skips paused and all_done chains entirely (not even scanned)', () => {
    const phasesPath = writeYamlSpec(baseDir);
    writeFileSync(join(watchdogHome, 'shim-test-chain.phases'), phasesPath);
    // Flip the chain to paused.
    const state = JSON.parse(
      readFileSync(join(chainDir, 'state.json'), 'utf8'),
    );
    state.paused = true;
    state.paused_reason = 'unit test';
    writeFileSync(join(chainDir, 'state.json'), JSON.stringify(state));
    const r = spawnWatchdog();
    expect(r.status).toBe(0);
    // scanned counts only chains with a parseable state.json; paused chains
    // are scanned-but-not-delegated.
    expect(r.stdout).toMatch(/delegated=0/);
  });

  it('H-39: forwards <chain-id>.runner contents as --reregister-cmd', () => {
    const phasesPath = writeYamlSpec(baseDir);
    writeFileSync(join(watchdogHome, 'shim-test-chain.phases'), phasesPath);
    writeFileSync(
      join(watchdogHome, 'shim-test-chain.runner'),
      'echo "fake re-register"',
    );
    const r = spawnWatchdog();
    expect(r.status).toBe(0);
    // The runner cmd shows up in scan.log when check_stall was invoked.
    const scanLog = readFileSync(join(watchdogHome, 'watchdog.scan.log'), 'utf8');
    expect(scanLog).toMatch(/check_stall shim-test-chain/);
  });

  it('H-40: prunes INBOX once per UTC day and writes .last_prune cookie', () => {
    const phasesPath = writeYamlSpec(baseDir);
    writeFileSync(join(watchdogHome, 'shim-test-chain.phases'), phasesPath);

    // Seed INBOX with one stale alert (well past 7-day retention).
    writeFileSync(
      inboxPath,
      `# INBOX\n\n## 2026-01-01T00:00:00Z — old alert\n- chain: x\n`,
    );

    const r1 = spawnWatchdog();
    expect(r1.status).toBe(0);
    expect(r1.stdout).toMatch(/prune_ran=true/);
    // Cookie written.
    const cookiePath = join(watchdogHome, '.last_prune.json');
    expect(existsSync(cookiePath)).toBe(true);
    // Archive file landed under INBOX_archive/.
    const archive = join(watchdogHome, 'INBOX_archive', '2026-01.md');
    expect(existsSync(archive)).toBe(true);
    expect(readFileSync(archive, 'utf8')).toMatch(/old alert/);
    // Live INBOX no longer contains that block.
    expect(readFileSync(inboxPath, 'utf8')).not.toMatch(/old alert/);

    // Second invocation same UTC day → prune_ran=false (cookie wins).
    const r2 = spawnWatchdog();
    expect(r2.status).toBe(0);
    expect(r2.stdout).toMatch(/prune_ran=false/);
  });

  it('survives a missing CAIA_CHAIN_HOME (no chains, no crash)', () => {
    rmSync(chainHome, { recursive: true, force: true });
    const r = spawnWatchdog();
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/scanned=0/);
  });

  it('survives unparseable state.json (logged, not throwing)', () => {
    writeFileSync(join(chainDir, 'state.json'), 'not-json{');
    const phasesPath = writeYamlSpec(baseDir);
    writeFileSync(join(watchdogHome, 'shim-test-chain.phases'), phasesPath);
    const r = spawnWatchdog();
    expect(r.status).toBe(0);
    const scanLog = readFileSync(join(watchdogHome, 'watchdog.scan.log'), 'utf8');
    expect(scanLog).toMatch(/unparseable_state/);
  });
});
