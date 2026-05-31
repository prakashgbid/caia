/**
 * Phase C4 — ADR-067 (snapshotter row-level tenant_id, V1 carve-out)
 * structural contract.
 *
 * Asserts the mirrored ADR in caia/docs/adr/ exists, declares Accepted
 * status, names the snapshotter as the one row-level exception, and
 * carries the migration triggers (10M rows / 25 tenants) so any future
 * agent can grep the trigger and know when to ship the schema-level
 * convergence.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(process.cwd(), '..', '..');
const ADR_PATH = join(
  REPO_ROOT,
  'docs',
  'adr',
  'ADR-067-snapshotter-row-level-tenant-id-canonical-for-v1.md',
);

describe('Phase C4 — ADR-067 snapshotter row-level tenant_id (V1)', () => {
  it('the ADR mirror exists in caia/docs/adr/', () => {
    expect(existsSync(ADR_PATH)).toBe(true);
  });

  const ADR = existsSync(ADR_PATH) ? readFileSync(ADR_PATH, 'utf-8') : '';

  it('declares Status: Accepted', () => {
    expect(ADR).toMatch(/^- \*\*Status:\*\*\s*Accepted\b/m);
  });

  it('names the snapshotter (@chiefaia/design-ingest) as the affected component', () => {
    expect(ADR).toMatch(/@chiefaia\/design-ingest/);
  });

  it('declares the V1 decision: keep row-level tenant_id', () => {
    expect(ADR).toMatch(
      /We will keep the snapshotter on row-level tenant_id through V1/,
    );
  });

  it('carries both migration triggers (10M rows / 25 tenants)', () => {
    expect(ADR).toMatch(/10M/);
    expect(ADR).toMatch(/25/);
  });

  it('cites the canonical source in caia-ea (so the mirror cannot drift silently)', () => {
    expect(ADR).toMatch(
      /caia-ea\/decisions\/ADR-067-snapshotter-row-level-tenant-id-canonical-for-v1\.md/,
    );
  });
});
