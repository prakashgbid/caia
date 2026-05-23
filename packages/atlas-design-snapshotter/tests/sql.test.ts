import { describe, expect, it } from 'vitest';

import { assertSafeSchemaName, schemaDDL } from '../src/index.js';

describe('sql identifier safety', () => {
  it('accepts a lowercase snake_case schema name', () => {
    expect(() => assertSafeSchemaName('caia_pt_dev')).not.toThrow();
  });

  it('rejects uppercase characters', () => {
    expect(() => assertSafeSchemaName('Caia')).toThrow();
  });

  it('rejects whitespace', () => {
    expect(() => assertSafeSchemaName('caia foo')).toThrow();
  });

  it('rejects a leading digit', () => {
    expect(() => assertSafeSchemaName('1caia')).toThrow();
  });

  it('rejects an injection attempt', () => {
    expect(() => assertSafeSchemaName('foo"; DROP TABLE x;--')).toThrow();
  });

  it('rejects an empty string', () => {
    expect(() => assertSafeSchemaName('')).toThrow();
  });

  it('schemaDDL embeds the schema only after asserting safety', () => {
    expect(() => schemaDDL('drop_me; --')).toThrow();
    const ddl = schemaDDL('caia_test');
    expect(ddl).toContain('CREATE SCHEMA IF NOT EXISTS "caia_test"');
    expect(ddl).toContain('"caia_test"."ux_uploads"');
    expect(ddl).toContain('"caia_test"."design_versions"');
    expect(ddl).toContain('"caia_test"."design_assets"');
  });
});
