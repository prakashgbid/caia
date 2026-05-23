/**
 * Cross-architect invariants — verifies Database's contributions to the
 * EA Reviewer's invariant registry (per spec §6.2).
 */

import { describe, it, expect } from 'vitest';

import { DATABASE_INVARIANTS } from '../src/invariants.js';
import { goldenExpectedOutput } from './helpers/fakes.js';

describe('DATABASE_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(DATABASE_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable, unique id', () => {
    const seen = new Set<string>();
    for (const inv of DATABASE_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `database`', () => {
    for (const inv of DATABASE_INVARIANTS) {
      expect(inv.contributor).toBe('database');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of DATABASE_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of DATABASE_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of DATABASE_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });

  it('every invariant reads only `database.*` paths', () => {
    for (const inv of DATABASE_INVARIANTS) {
      for (const path of inv.reads) {
        expect(path.startsWith('database.')).toBe(true);
      }
    }
  });
});

describe('DATABASE_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of DATABASE_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('tables-nonempty fails on an empty tables array', () => {
    const inv = DATABASE_INVARIANTS.find(i => i.id === 'database.tables-nonempty');
    expect(inv).toBeDefined();
    const empty = { ...goldenArch, 'database.tables': [] };
    expect(inv!.detect(empty)).toBe(false);
  });

  it('engine-is-postgres fails on MySQL', () => {
    const inv = DATABASE_INVARIANTS.find(i => i.id === 'database.engine-is-postgres');
    expect(inv).toBeDefined();
    const wrong = { ...goldenArch, 'database.engine': { name: 'mysql', version: '8.x' } };
    expect(inv!.detect(wrong)).toBe(false);
  });

  it('engine-is-postgres passes on postgres', () => {
    const inv = DATABASE_INVARIANTS.find(i => i.id === 'database.engine-is-postgres');
    expect(inv).toBeDefined();
    expect(inv!.detect(goldenArch)).toBe(true);
  });

  it('tenant-isolation-declared fails on an unknown model', () => {
    const inv = DATABASE_INVARIANTS.find(i => i.id === 'database.tenant-isolation-declared');
    expect(inv).toBeDefined();
    const wrong = {
      ...goldenArch,
      'database.tenantIsolationStrategy': { model: 'shared-everything' }
    };
    expect(inv!.detect(wrong)).toBe(false);
  });

  it('every-table-has-columns fails when a table is missing its column entries', () => {
    const inv = DATABASE_INVARIANTS.find(i => i.id === 'database.every-table-has-columns');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'database.columns': { tenants: [] } // missing contacts
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('every-table-has-id-and-timestamps fails when a table omits updated_at', () => {
    const inv = DATABASE_INVARIANTS.find(
      i => i.id === 'database.every-table-has-id-and-timestamps'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'database.columns': {
        tenants: [
          { name: 'id', type: 'uuid' },
          { name: 'created_at', type: 'timestamptz' }
        ],
        contacts: [
          { name: 'id', type: 'uuid' },
          { name: 'created_at', type: 'timestamptz' },
          { name: 'updated_at', type: 'timestamptz' }
        ]
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('migrations-have-up-and-down fails when down is missing', () => {
    const inv = DATABASE_INVARIANTS.find(i => i.id === 'database.migrations-have-up-and-down');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'database.migrations': [
        { id: '0001', up: 'CREATE TABLE x();', down: '' }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('rls-policies-cover-tenant-scoped-tables fails when a tenant table has no policies', () => {
    const inv = DATABASE_INVARIANTS.find(
      i => i.id === 'database.rls-policies-cover-tenant-scoped-tables'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'database.rlsPolicies': {} // contacts is tenant-scoped, no policies
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('jsonb-columns-have-shapes fails when payload has no shape descriptor', () => {
    const inv = DATABASE_INVARIANTS.find(i => i.id === 'database.jsonb-columns-have-shapes');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'database.jsonbShapes': {} // contacts.payload is jsonb but no shape
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('fk-columns-have-btree-indexes fails when an FK lacks a btree index', () => {
    const inv = DATABASE_INVARIANTS.find(i => i.id === 'database.fk-columns-have-btree-indexes');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'database.indexes': [
        // contacts_tenant_id_idx removed → FK contacts.tenant_id has no btree idx
        {
          table: 'tenants',
          name: 'tenants_slug_uk',
          columns: ['slug'],
          unique: true,
          method: 'btree'
        },
        {
          table: 'contacts',
          name: 'contacts_payload_gin',
          columns: ['payload'],
          unique: false,
          method: 'gin'
        }
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('every-table-has-lifecycle-rule fails when a table lacks a lifecycle entry', () => {
    const inv = DATABASE_INVARIANTS.find(
      i => i.id === 'database.every-table-has-lifecycle-rule'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'database.dataLifecycle': [
        { table: 'tenants', retentionDays: -1 }
        // contacts missing
      ]
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});
