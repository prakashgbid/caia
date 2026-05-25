import { describe, expect, it } from 'vitest';

import { MemoryBlobStorage } from '../src/storage/memory-blob.js';
import { MemoryProposalPersistence } from '../src/storage/postgres.js';

describe('MemoryBlobStorage', () => {
  it('returns a stable url + hash for a given path', async () => {
    const blob = new MemoryBlobStorage();
    const r = await blob.put({
      path: 'a/b/c.txt',
      body: Buffer.from('hello'),
      contentType: 'text/plain',
    });
    expect(r.url).toBe('memblob://memblob/a/b/c.txt');
    expect(r.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.bytes).toBe(5);
  });

  it('hash is deterministic on equal bytes', async () => {
    const blob = new MemoryBlobStorage();
    const r1 = await blob.put({ path: 'x', body: Buffer.from('a'), contentType: 't' });
    const r2 = await blob.put({ path: 'y', body: Buffer.from('a'), contentType: 't' });
    expect(r1.hash).toBe(r2.hash);
  });

  it('round-trips body bytes via read()', async () => {
    const blob = new MemoryBlobStorage();
    await blob.put({ path: 'p', body: Buffer.from('hi'), contentType: 'text/plain' });
    expect(blob.read('p')?.body.toString('utf8')).toBe('hi');
  });
});

describe('MemoryProposalPersistence', () => {
  const tenantProjectId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  function commonInput() {
    return {
      tenantProjectId,
      businessPlanHash: 'h1',
      execSummaryMd: '# exec',
      fullProposalMd: '# full',
      onePagerMd: '# one',
      formatsManifest: {},
      docHost: null,
      docHostUrls: null,
      designAppPrompt: {
        target: 'claude_design' as const,
        promptText: 'pt',
        promptMetadata: {},
        reviewerScore: 85,
        reviewerFindings: { x: 1 },
        reviewerBadge: 'ship' as const,
      },
      parentRevisionId: null,
      reason: null,
      diffSummary: null,
    };
  }

  it('writes a revision with revision_number = 1 on first call', async () => {
    const p = new MemoryProposalPersistence();
    const r = await p.writeRevision(commonInput());
    expect(r.proposal.revisionNumber).toBe(1);
    expect(r.prompt.businessProposalId).toBe(r.proposal.id);
    expect(r.revision.parentRevisionId).toBeNull();
  });

  it('bumps revision_number on subsequent calls and supersedes prior prompt', async () => {
    const p = new MemoryProposalPersistence();
    const r1 = await p.writeRevision(commonInput());
    const r2 = await p.writeRevision({ ...commonInput(), parentRevisionId: r1.revision.id });
    expect(r2.proposal.revisionNumber).toBe(2);
    // The prior prompt should now have superseded_by set.
    const prompts = p.listPrompts();
    const prior = prompts.find((x) => x.id === r1.prompt.id);
    expect(prior?.supersededBy).toBe(r2.proposal.id);
  });

  it('readLatestProposal returns the most recent revision', async () => {
    const p = new MemoryProposalPersistence();
    await p.writeRevision(commonInput());
    await p.writeRevision(commonInput());
    const latest = await p.readLatestProposal(tenantProjectId);
    expect(latest?.revisionNumber).toBe(2);
  });
});
