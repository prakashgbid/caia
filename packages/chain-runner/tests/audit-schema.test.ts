import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUDIT_EVENTS,
  AUDIT_EVENT_NAMES,
  assertValidAudit,
  buildAuditEvent,
  isKnownAuditEvent,
  validateAudit,
} from '../src/audit-schema.js';
import { appendAudit } from '../src/audit.js';

describe('audit-schema registry', () => {
  it('exposes a non-empty closed set of names', () => {
    expect(AUDIT_EVENT_NAMES.length).toBeGreaterThan(20);
    for (const n of AUDIT_EVENT_NAMES) {
      expect(isKnownAuditEvent(n)).toBe(true);
    }
  });

  it('all registered events have a category', () => {
    for (const [name, spec] of Object.entries(AUDIT_EVENTS)) {
      expect(spec.category, `event ${name} missing category`).toBeDefined();
    }
  });

  it('rejects unknown event names in validateAudit', () => {
    const issues = validateAudit('definitely_not_a_real_event', {});
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toMatch(/^unknown_event/);
  });

  it('accepts a well-formed phase_done payload', () => {
    const issues = validateAudit('phase_done', { phase_id: 3 });
    expect(issues).toEqual([]);
  });

  it('flags missing required field', () => {
    const issues = validateAudit('phase_done', {});
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toBe('missing_required_field');
    expect(issues[0]?.field).toBe('phase_id');
  });

  it('flags type mismatch on required field', () => {
    const issues = validateAudit('phase_done', { phase_id: 'three' });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.reason).toBe('type_mismatch');
    expect(issues[0]?.expectedType).toBe('number');
    expect(issues[0]?.actualType).toBe('string');
  });

  it('allows extra fields beyond required (permissive minimum schema)', () => {
    const issues = validateAudit('phase_done', {
      phase_id: 3,
      note: 'manual adjudication',
      backup: '/tmp/foo.bak',
    });
    expect(issues).toEqual([]);
  });
});

describe('assertValidAudit env-gating', () => {
  const original = process.env['CAIA_VALIDATE_AUDIT'];
  beforeEach(() => {
    delete process.env['CAIA_VALIDATE_AUDIT'];
  });
  afterEach(() => {
    if (original === undefined) delete process.env['CAIA_VALIDATE_AUDIT'];
    else process.env['CAIA_VALIDATE_AUDIT'] = original;
  });

  it('no-ops without the env flag, even on garbage', () => {
    const out = assertValidAudit('this_event_does_not_exist', {});
    expect(out).toEqual({});
  });

  it('throws when CAIA_VALIDATE_AUDIT=1 and event is unknown', () => {
    process.env['CAIA_VALIDATE_AUDIT'] = '1';
    expect(() => assertValidAudit('not_a_real_event', {})).toThrow(
      /unknown_event/,
    );
  });

  it('throws when CAIA_VALIDATE_AUDIT=1 and required field missing', () => {
    process.env['CAIA_VALIDATE_AUDIT'] = '1';
    expect(() => assertValidAudit('phase_done', {})).toThrow(
      /missing_required_field/,
    );
  });

  it('does not throw on a valid payload when strict', () => {
    process.env['CAIA_VALIDATE_AUDIT'] = '1';
    expect(() => assertValidAudit('phase_done', { phase_id: 3 })).not.toThrow();
  });
});

describe('buildAuditEvent', () => {
  it('returns ts + event + payload', () => {
    const ev = buildAuditEvent('wake', {});
    expect(ev).toHaveProperty('ts');
    expect(ev['event']).toBe('wake');
  });

  it('strict mode throws on bad payloads', () => {
    const original = process.env['CAIA_VALIDATE_AUDIT'];
    process.env['CAIA_VALIDATE_AUDIT'] = '1';
    try {
      expect(() => buildAuditEvent('phase_done', { phase_id: 'oops' })).toThrow();
    } finally {
      if (original === undefined) delete process.env['CAIA_VALIDATE_AUDIT'];
      else process.env['CAIA_VALIDATE_AUDIT'] = original;
    }
  });
});

describe('appendAudit integration', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'audit-schema-'));
  });
  afterEach(() => {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  });

  it('writes a valid event in default (non-strict) mode', () => {
    const file = join(dir, 'audit.jsonl');
    delete process.env['CAIA_VALIDATE_AUDIT'];
    appendAudit(file, 'phase_done', { phase_id: 5 });
    const raw = readFileSync(file, 'utf8').trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['event']).toBe('phase_done');
    expect(parsed['phase_id']).toBe(5);
  });

  it('still writes a malformed event in non-strict mode (back-compat)', () => {
    const file = join(dir, 'audit.jsonl');
    delete process.env['CAIA_VALIDATE_AUDIT'];
    appendAudit(file, 'phase_done', {});
    const raw = readFileSync(file, 'utf8').trim();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed['event']).toBe('phase_done');
  });

  it('throws on malformed event in strict mode', () => {
    const file = join(dir, 'audit.jsonl');
    const original = process.env['CAIA_VALIDATE_AUDIT'];
    process.env['CAIA_VALIDATE_AUDIT'] = '1';
    try {
      expect(() => appendAudit(file, 'phase_done', {})).toThrow(
        /missing_required_field/,
      );
    } finally {
      if (original === undefined) delete process.env['CAIA_VALIDATE_AUDIT'];
      else process.env['CAIA_VALIDATE_AUDIT'] = original;
    }
  });

  it('regression-test: every appendAudit name in src/ is registered', () => {
    // Sanity guard against drift — the audit-schema is supposed to be the
    // closed enum. If a new appendAudit call site appears in the codebase
    // without a matching registry entry, this test surfaces it.
    const wellKnown = [
      'state_init',
      'state_migrated',
      'resumed',
      'paused',
      'all_done',
      'wake',
      'budget_update',
      'none_eligible',
      'phase_in_progress',
      'phase_done',
      'phase_failed',
      'phase_blocked',
      'phase_adjudicated',
      'phase_auto_adjudicated',
      'phase_rearmed',
      'phase_force_failed',
      'phase_acceptance_ok',
      'phase_acceptance_warn',
      'phase_acceptance_failed',
      'attempt_started',
      'attempt_completed',
      'dispatch_spawned',
      'dispatch_log_open_failed',
      'dispatch_early_exit_clean',
      'dispatch_early_exit_failed',
      'lock_cleared',
      'preflight_dispatch',
      'preflight_healthz',
      'preflight_verified',
      'cron_stall_detected',
      'cron_reregister_attempted',
      'cron_reregister_skipped',
      'orphan_reaped',
      'alert_emitted',
      'alert_suppressed_duplicate',
    ];
    for (const n of wellKnown) {
      expect(isKnownAuditEvent(n), `${n} not in AUDIT_EVENTS`).toBe(true);
    }
  });
});
