/**
 * Test the generic bootstrapVecTable() helper. ARCH-### will use this
 * to spin its own arch_registry_vec without copy-paste from FREG.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { bootstrapVecTable, bootstrapVectorTables } from '../src';

describe('bootstrapVecTable — generic helper for ARCH coordination', () => {
  it('creates vec0 + fts5 with the configured prefix', () => {
    const db = new Database(':memory:');
    const result = bootstrapVecTable(db, { tablePrefix: 'arch_registry', dim: 64 });

    expect(result.tablePrefix).toBe('arch_registry');
    expect(result.dim).toBe(64);
    expect(result.vecVersion).toMatch(/^v\d+\.\d+/);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='virtual'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('arch_registry_vec');
    expect(names).toContain('arch_registry_fts');
    // Should NOT have created the feature_registry_* variants.
    expect(names).not.toContain('feature_registry_vec');
  });

  it('is idempotent — second call is a no-op', () => {
    const db = new Database(':memory:');
    bootstrapVecTable(db, { tablePrefix: 'thing', dim: 32 });
    expect(() =>
      bootstrapVecTable(db, { tablePrefix: 'thing', dim: 32 }),
    ).not.toThrow();
  });

  it('coexists with the legacy bootstrapVectorTables (feature_registry_*)', () => {
    const db = new Database(':memory:');
    bootstrapVectorTables(db, 768); // FREG default
    bootstrapVecTable(db, { tablePrefix: 'arch_registry', dim: 64 });

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='virtual'")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('feature_registry_vec');
    expect(names).toContain('feature_registry_fts');
    expect(names).toContain('arch_registry_vec');
    expect(names).toContain('arch_registry_fts');
  });

  it('respects custom ftsTokenize', () => {
    const db = new Database(':memory:');
    bootstrapVecTable(db, {
      tablePrefix: 'unicode_test',
      dim: 32,
      ftsTokenize: 'unicode61',
    });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' OR type='virtual'")
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toContain('unicode_test_fts');
  });
});
