import { describe, expect, it } from 'vitest';

import {
  GRAND_IDEA_WORD_CEILING,
  GRAND_IDEA_WORD_FLOOR,
  GrandIdeaError,
  MemoryGrandIdeaPersistence,
  computeWordCount,
  tenantSchemaName,
} from '../src/index.js';

const TENANT_SLUG = 'prakash-tiwari';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';

function makeMem(): MemoryGrandIdeaPersistence {
  const mem = new MemoryGrandIdeaPersistence({ tenantSchema: 'caia_pt' });
  mem.addTenant({
    id: 'tenant-1',
    slug: TENANT_SLUG,
    schemaName: 'caia_pt',
    onboardingComplete: true,
  });
  return mem;
}

describe('MemoryGrandIdeaPersistence', () => {
  it('writes a row and reads it back as the latest revision', async () => {
    const mem = makeMem();
    const row = await mem.writeGrandIdea({
      tenantSlug: TENANT_SLUG,
      projectId: PROJECT_ID,
      prompt: 'A daily newsletter that surfaces interesting open source releases',
      capturedBy: 'founder@example.com',
    });
    expect(row.revisionNumber).toBe(1);
    expect(row.tenantSlug).toBe(TENANT_SLUG);
    expect(row.promptWordCount).toBeGreaterThanOrEqual(GRAND_IDEA_WORD_FLOOR);

    const latest = await mem.readLatestGrandIdea(PROJECT_ID);
    expect(latest?.id).toBe(row.id);
    expect(latest?.revisionNumber).toBe(1);
  });

  it('bumps revision_number on subsequent writes for the same project', async () => {
    const mem = makeMem();
    await mem.writeGrandIdea({
      tenantSlug: TENANT_SLUG,
      projectId: PROJECT_ID,
      prompt: 'first idea for this project, a long enough one',
      capturedBy: 'founder@example.com',
    });
    const rev2 = await mem.writeGrandIdea({
      tenantSlug: TENANT_SLUG,
      projectId: PROJECT_ID,
      prompt: 'pivoted idea, slightly different focus and audience now',
      capturedBy: 'founder@example.com',
    });
    expect(rev2.revisionNumber).toBe(2);

    const latest = await mem.readLatestGrandIdea(PROJECT_ID);
    expect(latest?.revisionNumber).toBe(2);
    expect(mem.listRows().length).toBe(2);
  });

  it('rejects a prompt below the word floor', async () => {
    const mem = makeMem();
    await expect(
      mem.writeGrandIdea({
        tenantSlug: TENANT_SLUG,
        projectId: PROJECT_ID,
        prompt: 'too short',
        capturedBy: 'founder@example.com',
      }),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      context: { wordCount: 2, floor: GRAND_IDEA_WORD_FLOOR },
    });
  });

  it('rejects a prompt above the word ceiling', async () => {
    const mem = makeMem();
    const longPrompt = 'word '.repeat(GRAND_IDEA_WORD_CEILING + 10).trim();
    await expect(
      mem.writeGrandIdea({
        tenantSlug: TENANT_SLUG,
        projectId: PROJECT_ID,
        prompt: longPrompt,
        capturedBy: 'founder@example.com',
      }),
    ).rejects.toBeInstanceOf(GrandIdeaError);
  });

  it('preserves immutability — rows survive across re-captures', async () => {
    const mem = makeMem();
    const rev1 = await mem.writeGrandIdea({
      tenantSlug: TENANT_SLUG,
      projectId: PROJECT_ID,
      prompt: 'first capture of the founder idea, a long enough one',
      capturedBy: 'founder@example.com',
    });
    await mem.writeGrandIdea({
      tenantSlug: TENANT_SLUG,
      projectId: PROJECT_ID,
      prompt: 'pivoted to a different direction with new metrics here',
      capturedBy: 'founder@example.com',
    });
    const rows = mem.listRows();
    expect(rows.length).toBe(2);
    expect(rows.some((r) => r.id === rev1.id)).toBe(true);
    expect(rows.every((r) => r.metadata)).toBe(true);
  });

  it('returns null on readLatestGrandIdea when no rows exist', async () => {
    const mem = makeMem();
    const latest = await mem.readLatestGrandIdea(PROJECT_ID);
    expect(latest).toBeNull();
  });

  it('looks up tenants by slug', async () => {
    const mem = makeMem();
    const t = await mem.readTenant(TENANT_SLUG);
    expect(t?.slug).toBe(TENANT_SLUG);
    expect(t?.onboardingComplete).toBe(true);
    expect(await mem.readTenant('does-not-exist')).toBeNull();
  });

  it('records captured_by, captured_at, and metadata on the row', async () => {
    const mem = makeMem();
    const row = await mem.writeGrandIdea({
      tenantSlug: TENANT_SLUG,
      projectId: PROJECT_ID,
      prompt: 'newsletter with five concise summaries each morning, free tier',
      capturedBy: 'op@example.com',
      metadata: { source: 'cli', test: true },
    });
    expect(row.capturedBy).toBe('op@example.com');
    expect(row.metadata).toEqual({ source: 'cli', test: true });
    expect(typeof row.capturedAtIso).toBe('string');
    expect(() => new Date(row.capturedAtIso).toISOString()).not.toThrow();
  });
});

describe('tenantSchemaName', () => {
  it('produces a Postgres-safe schema name', () => {
    expect(tenantSchemaName('prakash-tiwari')).toBe('caia_prakash_tiwari');
    expect(tenantSchemaName('acme123')).toBe('caia_acme123');
  });
  it('rejects invalid slugs', () => {
    expect(() => tenantSchemaName('!!bad!!')).toThrow(GrandIdeaError);
    expect(() => tenantSchemaName('')).toThrow(GrandIdeaError);
  });
  it('truncates very long slugs', () => {
    const long = 'a'.repeat(64);
    const schema = tenantSchemaName(long);
    expect(schema.startsWith('caia_')).toBe(true);
    expect(schema.length).toBeLessThanOrEqual(5 + 24);
  });
});

describe('computeWordCount', () => {
  it('counts simple whitespace splits', () => {
    expect(computeWordCount('one two three')).toBe(3);
    expect(computeWordCount('   one   two   three   ')).toBe(3);
  });
  it('returns 0 on empty or whitespace-only input', () => {
    expect(computeWordCount('')).toBe(0);
    expect(computeWordCount('   ')).toBe(0);
  });
  it('treats unicode word-boundaries the same as ASCII whitespace', () => {
    expect(computeWordCount('hello\tworld\nfoo')).toBe(3);
  });
});
