/**
 * Verifies that `tenant.erased` (Phase B B8) is registered in the
 * canonical events registry alongside `tenant.provisioned`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY = readFileSync(
  join(process.cwd(), '..', '..', 'packages', 'events-taxonomy-internal', 'registry.yaml'),
  'utf-8',
);

describe('events-taxonomy-internal registry.yaml — tenant.erased', () => {
  it('contains the `tenant.erased` type', () => {
    expect(REGISTRY).toMatch(/- type:\s*tenant\.erased/);
  });

  it('declares severity: warning (irreversible action)', () => {
    const block = REGISTRY.split(/- type:\s*tenant\.erased/)[1] ?? '';
    expect(block).toMatch(/severity:\s*warning/);
  });

  it('lists actor with api+user+system', () => {
    const block = REGISTRY.split(/- type:\s*tenant\.erased/)[1] ?? '';
    expect(block).toMatch(/actor:\s*\[api, user, system\]/);
  });

  it('payload includes all the required cascade fields', () => {
    const block = REGISTRY.split(/- type:\s*tenant\.erased/)[1] ?? '';
    expect(block).toMatch(/tenant_id/);
    expect(block).toMatch(/email/);
    expect(block).toMatch(/schema_name/);
    expect(block).toMatch(/ux_uploads_deleted/);
    expect(block).toMatch(/secrets_workspace_deleted/);
    expect(block).toMatch(/schema_dropped/);
    expect(block).toMatch(/occurred_at_iso/);
  });
});
