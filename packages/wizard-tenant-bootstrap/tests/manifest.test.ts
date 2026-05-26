import { describe, expect, it } from 'vitest';
import { readFile, access } from 'node:fs/promises';

import { DEFAULT_MANIFEST, getDefaultManifest } from '../src/manifest.js';

describe('DEFAULT_MANIFEST', () => {
  it('has exactly 5 per-tenant entries (per AUDIT.md §2)', () => {
    expect(DEFAULT_MANIFEST.length).toBe(5);
  });

  it('lists the 5 canonical per-tenant packages in the documented order', () => {
    expect(DEFAULT_MANIFEST.map((e) => e.packageName)).toEqual([
      '@caia/grand-idea',
      '@caia/interviewer',
      '@caia/info-architect',
      '@caia/business-proposal-generator',
      '@caia-app/dashboard',
    ]);
  });

  it('every entry points at a real file on disk', async () => {
    for (const entry of DEFAULT_MANIFEST) {
      await expect(access(entry.sqlPath)).resolves.toBeUndefined();
    }
  });

  it('every entry contains the {{SCHEMA}} placeholder', async () => {
    for (const entry of DEFAULT_MANIFEST) {
      const sql = await readFile(entry.sqlPath, 'utf8');
      expect(
        sql,
        `${entry.packageName}/${entry.filename} must contain {{SCHEMA}}`,
      ).toMatch(/\{\{SCHEMA\}\}/);
    }
  });

  it('explicitly excludes the GLOBAL packages (state-machine, onboarding, design-ingest)', () => {
    const names = new Set(DEFAULT_MANIFEST.map((e) => e.packageName));
    expect(names.has('@caia/state-machine')).toBe(false);
    expect(names.has('@caia/onboarding')).toBe(false);
    expect(names.has('@caia/design-ingest')).toBe(false);
  });

  it('explicitly excludes the GLOBAL dashboard tenants_global migration', () => {
    const dashboardFiles = DEFAULT_MANIFEST.filter(
      (e) => e.packageName === '@caia-app/dashboard',
    ).map((e) => e.filename);
    expect(dashboardFiles).toEqual(['0010_wizard_state.sql']);
    expect(dashboardFiles).not.toContain('0011_tenants_global.sql');
  });

  it('getDefaultManifest() is a fresh array each call', () => {
    const a = getDefaultManifest();
    const b = getDefaultManifest();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
