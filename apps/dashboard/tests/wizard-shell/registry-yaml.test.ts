/**
 * Verifies that `tenant.provisioned` is registered in the canonical
 * events registry. We avoid a full YAML parse (no yaml dep yet in this
 * app) and assert on the raw text + structural neighbours.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY = readFileSync(
  join(process.cwd(), '..', '..', 'packages', 'events-taxonomy-internal', 'registry.yaml'),
  'utf-8',
);

describe('events-taxonomy-internal registry.yaml — tenant.provisioned', () => {
  it('contains the `tenant.provisioned` type', () => {
    expect(REGISTRY).toMatch(/- type:\s*tenant\.provisioned/);
  });

  it('declares severity: info', () => {
    const block = REGISTRY.split(/- type:\s*tenant\.provisioned/)[1] ?? '';
    expect(block).toMatch(/severity:\s*info/);
  });

  it('lists actor with api+user+system', () => {
    const block = REGISTRY.split(/- type:\s*tenant\.provisioned/)[1] ?? '';
    expect(block).toMatch(/actor:\s*\[api, user, system\]/);
  });

  it('payload includes the four required fields', () => {
    const block = REGISTRY.split(/- type:\s*tenant\.provisioned/)[1] ?? '';
    expect(block).toMatch(/tenant_id/);
    expect(block).toMatch(/email/);
    expect(block).toMatch(/schema_name/);
    expect(block).toMatch(/infisical_project_id/);
  });
});
