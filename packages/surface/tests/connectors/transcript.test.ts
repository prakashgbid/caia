import { describe, it, expect } from 'vitest';

import { createTranscriptConnector } from '../../src/connectors/transcript.js';
import { FakeFs } from '../__fixtures__/fs.js';

const NOW = '2026-05-09T12:00:00.000Z';
const SINCE = '2026-05-08T12:00:00.000Z';

function bigBody(): string { return 'x'.repeat(2000); }

describe('transcript connector', () => {
  it('finds transcript-shaped files in window', async () => {
    const fs = new FakeFs()
      .addDir('/sessions')
      .addDir('/sessions/run-1')
      .addFile('/sessions/run-1/handoff.md', bigBody(), '2026-05-09T03:00:00.000Z')
      .addFile('/sessions/run-1/error.log', bigBody(), '2026-05-09T04:00:00.000Z');
    const c = createTranscriptConnector({ transcriptRoot: '/sessions', fs });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.find(f => f.key.endsWith('handoff.md'))?.kind).toBe('transcript-handoff');
    expect(r.findings.find(f => f.key.endsWith('error.log'))?.kind).toBe('transcript-failure');
  });

  it('returns warning + empty when root missing', async () => {
    const fs = new FakeFs();
    const c = createTranscriptConnector({ transcriptRoot: '/no/such', fs });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(0);
    expect(r.warnings.length).toBe(1);
  });

  it('skips files outside time window', async () => {
    const fs = new FakeFs()
      .addDir('/s')
      .addFile('/s/handoff.md', bigBody(), '2026-04-01T00:00:00.000Z');
    const c = createTranscriptConnector({ transcriptRoot: '/s', fs });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(0);
  });

  it('skips tiny files (heuristic <32 bytes)', async () => {
    const fs = new FakeFs()
      .addDir('/s')
      .addFile('/s/handoff.md', 'tiny', '2026-05-09T03:00:00.000Z');
    const c = createTranscriptConnector({ transcriptRoot: '/s', fs });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(0);
  });

  it('skips non-transcript extensions', async () => {
    const fs = new FakeFs()
      .addDir('/s')
      .addFile('/s/blob.bin', bigBody(), '2026-05-09T03:00:00.000Z');
    const c = createTranscriptConnector({ transcriptRoot: '/s', fs });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(0);
  });

  it('respects depth cap', async () => {
    const fs = new FakeFs()
      .addDir('/s')
      .addDir('/s/a').addDir('/s/a/b').addDir('/s/a/b/c').addDir('/s/a/b/c/d')
      .addFile('/s/a/b/c/d/handoff.md', bigBody(), '2026-05-09T03:00:00.000Z');
    const c = createTranscriptConnector({ transcriptRoot: '/s', fs, maxDepth: 2 });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBe(0);
  });

  it('respects maxFindings cap', async () => {
    const fs = new FakeFs().addDir('/s');
    for (let i = 0; i < 10; i++) {
      fs.addFile(`/s/handoff-${i}.md`, bigBody(), '2026-05-09T03:00:00.000Z');
    }
    const c = createTranscriptConnector({ transcriptRoot: '/s', fs, maxFindings: 3 });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings.length).toBeLessThanOrEqual(3);
  });

  it('default kind for non-keyword filename is handoff', async () => {
    const fs = new FakeFs()
      .addDir('/s')
      .addFile('/s/random.md', bigBody(), '2026-05-09T03:00:00.000Z');
    const c = createTranscriptConnector({ transcriptRoot: '/s', fs });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings[0]?.kind).toBe('transcript-handoff');
  });

  it('tags large files', async () => {
    const fs = new FakeFs()
      .addDir('/s')
      .addFile('/s/big.md', 'a'.repeat(150_000), '2026-05-09T03:00:00.000Z');
    const c = createTranscriptConnector({ transcriptRoot: '/s', fs });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.findings[0]?.tags).toContain('large');
  });

  it('finding ids are deterministic across runs', async () => {
    const fs1 = new FakeFs().addDir('/s').addFile('/s/handoff.md', bigBody(), '2026-05-09T03:00:00.000Z');
    const fs2 = new FakeFs().addDir('/s').addFile('/s/handoff.md', bigBody(), '2026-05-09T03:00:00.000Z');
    const c1 = createTranscriptConnector({ transcriptRoot: '/s', fs: fs1 });
    const c2 = createTranscriptConnector({ transcriptRoot: '/s', fs: fs2 });
    const r1 = await c1.collect({ sinceIso: SINCE, untilIso: NOW });
    const r2 = await c2.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r1.findings.map(f => f.id)).toEqual(r2.findings.map(f => f.id));
  });

  it('emits no warnings on happy path', async () => {
    const fs = new FakeFs()
      .addDir('/s')
      .addFile('/s/handoff.md', bigBody(), '2026-05-09T03:00:00.000Z');
    const c = createTranscriptConnector({ transcriptRoot: '/s', fs });
    const r = await c.collect({ sinceIso: SINCE, untilIso: NOW });
    expect(r.warnings.length).toBe(0);
  });
});
