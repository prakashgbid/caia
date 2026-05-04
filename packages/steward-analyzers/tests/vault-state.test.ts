import { describe, it, expect } from 'vitest';
import {
  checkSnapshotAge,
  checkTokenExpiry,
  checkAuditLogRotation,
} from '../src/vault-state.js';

const NOW = 1779840000; // 2026-05-04 06:00:00 UTC
const HOUR = 3600;
const DAY = 86400;

describe('checkSnapshotAge (failure mode #7)', () => {
  it('returns no findings when both sides have fresh snapshots', () => {
    const findings = checkSnapshotAge({
      snapshots: [
        { side: 'mac', path: '/snap/a.snap', mtimeEpoch: NOW - 1 * HOUR },
        { side: 'stolution', path: '/snap/b.snap', mtimeEpoch: NOW - 5 * HOUR },
      ],
      nowEpoch: NOW,
    });
    expect(findings).toEqual([]);
  });

  it('flags missing snapshots as high severity', () => {
    const findings = checkSnapshotAge({
      snapshots: [
        { side: 'mac', path: null, mtimeEpoch: null },
      ],
      nowEpoch: NOW,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].ruleId).toBe('snapshot-missing');
  });

  it('flags stale (>26h) snapshots as high severity', () => {
    const findings = checkSnapshotAge({
      snapshots: [
        {
          side: 'stolution',
          path: '/snap/old.snap',
          mtimeEpoch: NOW - 27 * HOUR,
        },
      ],
      nowEpoch: NOW,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].ruleId).toBe('snapshot-stale');
    expect(findings[0].context?.ageHours).toBe(27);
  });

  it('honours custom maxAgeHours', () => {
    const findings = checkSnapshotAge({
      snapshots: [
        { side: 'mac', path: '/snap/a.snap', mtimeEpoch: NOW - 12 * HOUR },
      ],
      nowEpoch: NOW,
      maxAgeHours: 6,
    });
    expect(findings).toHaveLength(1);
  });

  it('flags both sides independently', () => {
    const findings = checkSnapshotAge({
      snapshots: [
        { side: 'mac', path: null, mtimeEpoch: null },
        {
          side: 'stolution',
          path: '/snap/b.snap',
          mtimeEpoch: NOW - 30 * HOUR,
        },
      ],
      nowEpoch: NOW,
    });
    expect(findings).toHaveLength(2);
    expect(findings[0].context?.side).toBe('mac');
    expect(findings[1].context?.side).toBe('stolution');
  });
});

describe('checkTokenExpiry (failure mode #9)', () => {
  it('returns no findings for healthy tokens (>30d to expiry)', () => {
    const findings = checkTokenExpiry({
      secrets: [
        {
          path: 'secret/foo',
          key: 'github_pat',
          expiresAtEpoch: NOW + 60 * DAY,
        },
      ],
      nowEpoch: NOW,
    });
    expect(findings).toEqual([]);
  });

  it('returns medium severity at 8-30 days', () => {
    const findings = checkTokenExpiry({
      secrets: [
        {
          path: 'secret/foo',
          key: 'github_pat',
          expiresAtEpoch: NOW + 14 * DAY,
        },
      ],
      nowEpoch: NOW,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('medium');
    expect(findings[0].context?.daysToExpiry).toBe(14);
  });

  it('returns high severity at <=7 days', () => {
    const findings = checkTokenExpiry({
      secrets: [
        {
          path: 'secret/foo',
          key: 'cf_token',
          expiresAtEpoch: NOW + 3 * DAY,
        },
      ],
      nowEpoch: NOW,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
  });

  it('handles past-due (negative days) as high severity', () => {
    const findings = checkTokenExpiry({
      secrets: [
        {
          path: 'secret/expired',
          key: 'old_pat',
          expiresAtEpoch: NOW - 1 * DAY,
        },
      ],
      nowEpoch: NOW,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('high');
    expect(findings[0].context?.daysToExpiry).toBe(-1);
  });

  it('skips secrets without an expiry', () => {
    const findings = checkTokenExpiry({
      secrets: [
        { path: 'secret/foo', key: 'no_expiry', expiresAtEpoch: null },
      ],
      nowEpoch: NOW,
    });
    expect(findings).toEqual([]);
  });

  it('honours custom warnDays / highDays thresholds', () => {
    const findings = checkTokenExpiry({
      secrets: [
        {
          path: 'secret/foo',
          key: 'k',
          expiresAtEpoch: NOW + 50 * DAY,
        },
      ],
      nowEpoch: NOW,
      warnDays: 90,
      highDays: 60,
    });
    expect(findings[0].severity).toBe('high');
  });
});

describe('checkAuditLogRotation (failure mode #8)', () => {
  it('returns no findings on a healthy state', () => {
    const findings = checkAuditLogRotation({
      state: {
        path: '/audit.log',
        sizeBytes: 100_000_000, // 100 MB — fine
        rotationMtimeEpoch: NOW - 1 * HOUR,
      },
      nowEpoch: NOW,
    });
    expect(findings).toEqual([]);
  });

  it('flags oversized audit log (>1 GB)', () => {
    const findings = checkAuditLogRotation({
      state: {
        path: '/audit.log',
        sizeBytes: 1_500_000_000,
        rotationMtimeEpoch: NOW - 1 * HOUR,
      },
      nowEpoch: NOW,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('audit-log-oversized');
  });

  it('flags stale rotation (>26h since last)', () => {
    const findings = checkAuditLogRotation({
      state: {
        path: '/audit.log',
        sizeBytes: 50_000,
        rotationMtimeEpoch: NOW - 30 * HOUR,
      },
      nowEpoch: NOW,
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].ruleId).toBe('audit-log-rotation-stale');
  });

  it('flags both conditions independently', () => {
    const findings = checkAuditLogRotation({
      state: {
        path: '/audit.log',
        sizeBytes: 2_000_000_000,
        rotationMtimeEpoch: NOW - 30 * HOUR,
      },
      nowEpoch: NOW,
    });
    expect(findings).toHaveLength(2);
  });
});
