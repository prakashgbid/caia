/**
 * Migration smoke tests — text shape only (no actual Postgres).
 * Confirms idempotency clauses + placeholder consistency.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const M_DIR = join(process.cwd(), 'migrations');

describe('0010_wizard_state.sql', () => {
  const sql = readFileSync(join(M_DIR, '0010_wizard_state.sql'), 'utf-8');

  it('uses the {{SCHEMA}} placeholder (per-tenant pattern)', () => {
    expect(sql).toMatch(/\{\{SCHEMA\}\}/);
  });

  it('CREATEs the wizard_state table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS .+wizard_state/);
  });

  it('constrains current_step_idx to 1..7', () => {
    expect(sql).toMatch(/CHECK.*current_step_idx BETWEEN 1 AND 7/);
  });

  it('declares the updated_at trigger', () => {
    expect(sql).toMatch(/CREATE TRIGGER wizard_state_touch/);
  });
});

describe('0011_tenants_global.sql', () => {
  const sql = readFileSync(join(M_DIR, '0011_tenants_global.sql'), 'utf-8');

  it('does NOT use {{SCHEMA}} (this is a GLOBAL migration)', () => {
    expect(sql).not.toMatch(/\{\{SCHEMA\}\}/);
  });

  it('CREATEs the tenants table idempotently', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS tenants/);
  });

  it('UNIQUE-constrains email + schema_name + infisical_project_id', () => {
    expect(sql).toMatch(/email\s+CITEXT\s+NOT NULL\s+UNIQUE/);
    expect(sql).toMatch(/schema_name\s+TEXT\s+NOT NULL\s+UNIQUE/);
    expect(sql).toMatch(/infisical_project_id\s+TEXT\s+NOT NULL\s+UNIQUE/);
  });

  it('CHECK-constrains schema_name to ^tenant_[a-z0-9_]+$', () => {
    expect(sql).toMatch(/schema_name\s+~\s+'\^tenant_/);
  });

  it('enables citext + pgcrypto extensions', () => {
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS citext/);
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pgcrypto/);
  });

  it('creates the tenant_provision_attempts audit table', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS tenant_provision_attempts/);
  });
});
