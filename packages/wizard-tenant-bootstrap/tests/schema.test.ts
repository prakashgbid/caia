import { describe, expect, it } from 'vitest';

import {
  TENANT_SCHEMA_RE,
  assertValidTenantSchema,
  quoteSchema,
} from '../src/schema.js';

describe('schema validation', () => {
  it('TENANT_SCHEMA_RE matches the canonical provisioning shape', () => {
    expect(TENANT_SCHEMA_RE.test('tenant_prakash_stolution_com_abc12345')).toBe(true);
    expect(TENANT_SCHEMA_RE.test('tenant_a')).toBe(true);
  });

  it('rejects names without the tenant_ prefix', () => {
    expect(() => assertValidTenantSchema('caia_foo')).toThrow(/invalid tenant schema/);
    expect(() => assertValidTenantSchema('public')).toThrow(/invalid tenant schema/);
  });

  it('rejects names with uppercase or special characters', () => {
    expect(() => assertValidTenantSchema('Tenant_foo')).toThrow();
    expect(() => assertValidTenantSchema('tenant_foo-bar')).toThrow();
    expect(() => assertValidTenantSchema('tenant_foo;DROP TABLE x;')).toThrow();
  });

  it('rejects empty / whitespace strings', () => {
    expect(() => assertValidTenantSchema('')).toThrow();
    expect(() => assertValidTenantSchema('tenant_')).toThrow();
    expect(() => assertValidTenantSchema(' tenant_foo')).toThrow();
  });

  it('rejects names over Postgres NAMEDATALEN cap (63)', () => {
    const long = 'tenant_' + 'a'.repeat(60); // 67 chars
    expect(() => assertValidTenantSchema(long)).toThrow(/63-char/);
  });

  it('quoteSchema wraps a validated name in double quotes', () => {
    expect(quoteSchema('tenant_foo_bar_12345abc')).toBe('"tenant_foo_bar_12345abc"');
  });

  it('quoteSchema validates before quoting (no injection)', () => {
    expect(() => quoteSchema('tenant_a"; DROP TABLE x;--')).toThrow();
  });
});
