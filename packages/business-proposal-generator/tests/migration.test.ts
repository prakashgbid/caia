import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIG = join(HERE, '..', 'migrations', '0001_business_proposals.sql');

describe('0001_business_proposals.sql', () => {
  it('contains the {{SCHEMA}} placeholder', async () => {
    const sql = await readFile(MIG, 'utf8');
    expect(sql).toMatch(/\{\{SCHEMA\}\}/);
  });

  it('creates the three tables', async () => {
    const sql = await readFile(MIG, 'utf8');
    for (const t of ['business_proposals', 'designapp_prompts', 'proposal_revisions']) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS \\{\\{SCHEMA\\}\\}\\.${t}`));
    }
  });

  it('enforces the target enum via CHECK', async () => {
    const sql = await readFile(MIG, 'utf8');
    expect(sql).toMatch(/target IN/);
    for (const t of ['claude_design', 'figma', 'v0', 'lovable', 'bolt', 'builderio', 'webflow']) {
      expect(sql).toContain(`'${t}'`);
    }
  });

  it('has unique (tenant_project_id, revision_number)', async () => {
    const sql = await readFile(MIG, 'utf8');
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS business_proposals_proj_rev_idx/);
  });

  it('installs LISTEN/NOTIFY trigger', async () => {
    const sql = await readFile(MIG, 'utf8');
    expect(sql).toMatch(/pg_notify\('business_proposal_ready'/);
    expect(sql).toMatch(/CREATE TRIGGER business_proposal_ready_notify/i);
  });
});
