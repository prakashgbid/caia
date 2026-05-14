import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatPreflightLine,
  parseResetIsoFromBanner,
  preflightDispatch,
} from '../src/preflight.js';

// Build a shell-script "claude" stub that prints canned text on stdout and
// optionally on stderr. Tests use these to drive every branch of the
// preflight decision tree without needing the real binary.
function makeStub(dir: string, name: string, body: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/bash\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'caia-preflight-'));
});

afterEach(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---------------------------------------------------------------------------
// Fixture P01 — healthy path: stub prints PREFLIGHT_OK
// ---------------------------------------------------------------------------
describe('P01_preflight_healthy', () => {
  it('returns status=healthy, exit_code=0 when claude prints PREFLIGHT_OK', async () => {
    const stub = makeStub(workDir, 'claude_ok', 'echo PREFLIGHT_OK');
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 4000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    expect(r.status).toBe('healthy');
    expect(r.exit_code).toBe(0);
    expect(r.raw).toMatch(/PREFLIGHT_OK/);
  });
});

// ---------------------------------------------------------------------------
// Fixture P02 — rate_limited with parseable reset banner
// ---------------------------------------------------------------------------
describe('P02_preflight_rate_limited_with_reset', () => {
  it('returns status=rate_limited, exit_code=2, reset_iso parsed', async () => {
    const stub = makeStub(
      workDir,
      'claude_ratelimit',
      "echo \"You've hit your limit · resets May 16 at 12pm (America/New_York)\"",
    );
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 4000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    expect(r.status).toBe('rate_limited');
    expect(r.exit_code).toBe(2);
    expect(r.reset_banner).toMatch(/resets May 16/);
    expect(r.reset_iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});

// ---------------------------------------------------------------------------
// Fixture P03 — rate_limited but no reset banner (still exit 2)
// ---------------------------------------------------------------------------
describe('P03_preflight_rate_limited_no_reset', () => {
  it('returns rate_limited with reset_iso undefined when banner missing', async () => {
    const stub = makeStub(
      workDir,
      'claude_ratelimit_nores',
      "echo \"You've hit your limit. Try again later.\"",
    );
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 4000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    expect(r.status).toBe('rate_limited');
    expect(r.exit_code).toBe(2);
    expect(r.reset_iso).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Fixture P04 — auth_failure (401)
// ---------------------------------------------------------------------------
describe('P04_preflight_auth_failure', () => {
  it('returns auth_failure exit_code=3 on API Error 401', async () => {
    const stub = makeStub(
      workDir,
      'claude_auth',
      'echo "API Error 401 Unauthorized: invalid api key" >&2 ; exit 1',
    );
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 4000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    expect(r.status).toBe('auth_failure');
    expect(r.exit_code).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Fixture P05 — timeout
// ---------------------------------------------------------------------------
describe('P05_preflight_timeout', () => {
  it('returns timeout exit_code=4 when claude hangs', async () => {
    const stub = makeStub(workDir, 'claude_hang', 'sleep 10');
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 500,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    expect(r.status).toBe('timeout');
    expect(r.exit_code).toBe(4);
    expect(r.elapsed_ms).toBeGreaterThanOrEqual(400);
  });
});

// ---------------------------------------------------------------------------
// Fixture P06 — unknown (claude responds but no recognized banner)
// ---------------------------------------------------------------------------
describe('P06_preflight_unknown', () => {
  it('returns unknown exit_code=5 when output matches no decision branch', async () => {
    const stub = makeStub(
      workDir,
      'claude_unknown',
      'echo "some random response with no recognized markers"',
    );
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 4000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    expect(r.status).toBe('unknown');
    expect(r.exit_code).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Fixture P07 — api_key_leak refuses without spawning
// ---------------------------------------------------------------------------
describe('P07_preflight_api_key_leak', () => {
  it('returns api_key_leak exit_code=6 when ANTHROPIC_API_KEY is set', async () => {
    const stub = makeStub(
      workDir,
      'claude_should_not_run',
      'echo PREFLIGHT_OK_SHOULD_NOT_BE_CALLED',
    );
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 4000,
      env: { ...process.env, ANTHROPIC_API_KEY: 'sk-secret-leak' },
    });
    expect(r.status).toBe('api_key_leak');
    expect(r.exit_code).toBe(6);
    // raw must be empty — we refused without spawning.
    expect(r.raw).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Fixture P08 — api_key_leak refusal can be overridden via refuseIfApiKeySet:false
// ---------------------------------------------------------------------------
describe('P08_preflight_api_key_override', () => {
  it('proceeds with refuseIfApiKeySet=false even when API key is set', async () => {
    const stub = makeStub(workDir, 'claude_ok2', 'echo PREFLIGHT_OK');
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 4000,
      refuseIfApiKeySet: false,
      env: { ...process.env, ANTHROPIC_API_KEY: 'sk-allowed-in-tests' },
    });
    expect(r.status).toBe('healthy');
    expect(r.exit_code).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture P09 — missing binary (ENOENT) → preflight_error / generic
// ---------------------------------------------------------------------------
describe('P09_preflight_binary_missing', () => {
  it('returns preflight_error exit_code=1 when binary is missing (ENOENT)', async () => {
    const r = await preflightDispatch({
      binary: '/nonexistent/claude-does-not-exist',
      timeoutMs: 4000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    // Node may surface this as exit code 1 ('preflight_error') or via the
    // child's exit listener firing with code !=0 and no banner (status=unknown).
    expect([1, 5]).toContain(r.exit_code);
    expect(r.status === 'preflight_error' || r.status === 'unknown').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture P10 — rate-limit precedes auth when both appear in output
// ---------------------------------------------------------------------------
describe('P10_preflight_rate_limit_precedes_auth', () => {
  it('classifies as rate_limited when output also contains an auth banner', async () => {
    const stub = makeStub(
      workDir,
      'claude_mixed',
      'echo "You\'ve hit your limit · resets May 16 at 12pm" ; echo "Invalid authentication credentials"',
    );
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 4000,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    expect(r.status).toBe('rate_limited');
    expect(r.exit_code).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Fixture P11 — formatPreflightLine emits the wake-script-grep contract
// ---------------------------------------------------------------------------
describe('P11_format_preflight_line', () => {
  it('emits PREFLIGHT status=... exit=... elapsed_ms=... [reset_iso=...] [reset_banner=...]', () => {
    const line = formatPreflightLine({
      status: 'rate_limited',
      exit_code: 2,
      message: 'rate limit hit (resets May 16 at 12pm)',
      elapsed_ms: 1234,
      raw: '',
      reset_iso: '2026-05-16T16:00:00Z',
      reset_banner: 'resets May 16 at 12pm (America/New_York)',
    });
    expect(line).toContain('PREFLIGHT status=rate_limited');
    expect(line).toContain('exit=2');
    expect(line).toContain('elapsed_ms=1234');
    expect(line).toContain('reset_iso=2026-05-16T16:00:00Z');
    expect(line).toContain('reset_banner="resets May 16 at 12pm (America/New_York)"');
  });
});

// ---------------------------------------------------------------------------
// Fixture P12 — log path is appended after the run
// ---------------------------------------------------------------------------
describe('P12_preflight_log_path', () => {
  it('appends raw output to --log path on completion', async () => {
    const stub = makeStub(workDir, 'claude_ok3', 'echo PREFLIGHT_OK');
    const log = join(workDir, 'preflight.log');
    writeFileSync(log, '');
    const r = await preflightDispatch({
      binary: stub,
      timeoutMs: 4000,
      logPath: log,
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
    });
    expect(r.status).toBe('healthy');
    expect(existsSync(log)).toBe(true);
    const body = readFileSync(log, 'utf8');
    expect(body).toMatch(/PREFLIGHT_OK/);
    expect(body).toMatch(/--- preflight \d{4}-\d{2}-\d{2}T/);
  });
});

// ---------------------------------------------------------------------------
// Fixture P13 — reset banner parsing: month+day+time+tz
// ---------------------------------------------------------------------------
describe('P13_reset_banner_parse_full', () => {
  it('parses "resets May 16 at 12pm (America/New_York)" to a UTC ISO', () => {
    const nowMs = Date.parse('2026-05-14T18:00:00Z');
    const r = parseResetIsoFromBanner(
      "You've hit your limit · resets May 16 at 12pm (America/New_York)",
      nowMs,
    );
    expect(r.iso).toMatch(/^2026-05-1[67]T(15|16):/);
    expect(r.matched).toMatch(/resets May 16 at 12pm/);
  });
});

// ---------------------------------------------------------------------------
// Fixture P14 — reset banner parsing: time-only (no month/day) bumps to tomorrow
// when the time has already passed today.
// ---------------------------------------------------------------------------
describe('P14_reset_banner_parse_time_only', () => {
  it('parses "resets at 4pm (America/New_York)" relative to now', () => {
    // Now = 2026-05-14 22:00 UTC → 18:00 EDT. "4pm" today (16:00 EDT = 20:00
    // UTC) has already passed, so bump to tomorrow.
    const nowMs = Date.parse('2026-05-14T22:00:00Z');
    const r = parseResetIsoFromBanner(
      'resets at 4pm (America/New_York)',
      nowMs,
    );
    expect(r.iso).not.toBeNull();
    if (r.iso) {
      const t = Date.parse(r.iso);
      expect(t).toBeGreaterThan(nowMs);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixture P15 — reset banner missing → iso null
// ---------------------------------------------------------------------------
describe('P15_reset_banner_missing', () => {
  it('returns iso null and matched null when banner absent', () => {
    const r = parseResetIsoFromBanner(
      'some unrelated text without a reset banner',
      Date.now(),
    );
    expect(r.iso).toBeNull();
    expect(r.matched).toBeNull();
  });
});
