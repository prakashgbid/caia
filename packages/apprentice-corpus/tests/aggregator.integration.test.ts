/**
 * Integration test — exercises the full ApprenticeCorpusAggregator
 * pipeline against fixture corpora across all 5 readers, with no real
 * network or subprocess calls. Verifies that the manifest written to
 * disk matches the expected shape and that samples.jsonl is parseable.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ApprenticeCorpusAggregator } from '../src/aggregator.js';
import { defaultFsReader } from '../src/fs-reader.js';
import {
  createFakeDistiller,
  createFakeEventBus,
  createFakeGithub,
  createFakeLangfuse
} from './helpers/fakes.js';

const FIXTURE_MEMORY = join(__dirname, '__fixtures__', 'mini-memory');
const FIXTURE_REPORTS = join(__dirname, '__fixtures__', 'mini-reports');

describe('ApprenticeCorpusAggregator — integration with fixtures', () => {
  let outputRoot: string;
  beforeEach(() => {
    outputRoot = mkdtempSync(join(tmpdir(), 'apprentice-corpus-int-'));
  });
  afterEach(() => {
    rmSync(outputRoot, { recursive: true, force: true });
  });

  it('runs end-to-end over fixture memory + reports + fake events + fake PRs', async () => {
    const fixedClock = () => new Date('2026-05-06T12:00:00Z');
    const eventTime = Date.parse('2026-05-04T00:00:00Z');
    const prTime = Date.parse('2026-05-05T00:00:00Z');

    const agg = new ApprenticeCorpusAggregator({
      memoryRoot: FIXTURE_MEMORY,
      reportsRoot: FIXTURE_REPORTS,
      outputRoot,
      distillEnabled: false,
      maxAgeDays: 365,
      qualityThreshold: 0.0, // accept everything for the integration test
      fs: defaultFsReader,
      eventBus: createFakeEventBus([
        {
          id: 'evt-1',
          type: 'PRMerged',
          emittedAtMs: eventTime,
          payload: {
            prNumber: 999,
            title: 'feat(test): integration fixture event',
            body: 'A merged PR event used to verify the event-bus reader feeds the aggregator end-to-end. The body is comfortably long enough to clear the minimum-length threshold and contribute a real instruction-output sample to the corpus.'
          }
        },
        {
          id: 'evt-2',
          type: 'OperatorCorrection',
          emittedAtMs: eventTime + 1000,
          payload: {
            correction: 'Do not use API-key billing. Always use the subscription path via the claude binary. The pay-per-token mode is forbidden per feedback_no_api_key_billing.md and would burn through the budget in days.'
          }
        }
      ]),
      github: createFakeGithub([
        {
          number: 1,
          title: 'feat(test): fixture pr',
          body: 'Body of a merged PR fixture, sufficiently long to make it through the normaliser and quality scorer end-to-end so the integration test exercises the github reader path.',
          url: 'https://example.test/pr/1',
          mergedAtMs: prTime
        }
      ]),
      langfuse: createFakeLangfuse([]),
      claudeDistiller: createFakeDistiller(() => {
        throw new Error('distill should not be called when disabled');
      }),
      clock: fixedClock
    });

    const manifest = await agg.aggregate();

    expect(manifest.version).toBe(1);
    expect(manifest.totals.rawArtifacts).toBe(6); // 2 memory + 1 report + 2 events + 1 github
    expect(manifest.totals.final).toBeGreaterThan(0);
    expect(manifest.perSource.memory.artifacts).toBe(2);
    expect(manifest.perSource.reports.artifacts).toBe(1);
    expect(manifest.perSource.events.artifacts).toBe(2);
    expect(manifest.perSource.github.artifacts).toBe(1);
    expect(manifest.perSource.langfuse.artifacts).toBe(0);
    expect(manifest.warnings).toEqual([]);

    // Output dir is dated
    const expectedDir = join(outputRoot, '2026-05-06');
    expect(existsSync(expectedDir)).toBe(true);
    expect(existsSync(join(expectedDir, 'manifest.json'))).toBe(true);
    expect(existsSync(join(expectedDir, 'samples.jsonl'))).toBe(true);
    expect(existsSync(join(expectedDir, 'sources.json'))).toBe(true);
    expect(existsSync(join(expectedDir, 'dropped.jsonl'))).toBe(true);
    expect(existsSync(join(expectedDir, 'config.json'))).toBe(true);

    // samples.jsonl parses one JSON per line
    const samplesText = readFileSync(join(expectedDir, 'samples.jsonl'), 'utf-8');
    const lines = samplesText.split('\n').filter((l) => l !== '');
    expect(lines.length).toBe(manifest.totals.final);
    for (const line of lines) {
      const obj = JSON.parse(line);
      expect(obj.id).toBeDefined();
      expect(Array.isArray(obj.messages)).toBe(true);
      expect(obj.messages.length).toBe(3);
      expect(obj.messages[0].role).toBe('system');
      expect(obj.messages[1].role).toBe('user');
      expect(obj.messages[2].role).toBe('assistant');
      expect(typeof obj.meta.qualityScore).toBe('number');
      expect(typeof obj.meta.contentSha256).toBe('string');
    }
  });

  it('respects --dry-run by writing nothing', async () => {
    const agg = new ApprenticeCorpusAggregator({
      memoryRoot: FIXTURE_MEMORY,
      reportsRoot: FIXTURE_REPORTS,
      outputRoot,
      distillEnabled: false,
      qualityThreshold: 0.0,
      eventBus: createFakeEventBus([]),
      github: createFakeGithub([]),
      langfuse: createFakeLangfuse([]),
      clock: () => new Date('2026-05-06T12:00:00Z')
    });
    const manifest = await agg.aggregate({ dryRun: true });
    expect(manifest.totals.final).toBeGreaterThan(0);
    const expectedDir = join(outputRoot, '2026-05-06');
    expect(existsSync(expectedDir)).toBe(false);
  });

  it('redacts credentials from fixture report (PII masking enabled by default)', async () => {
    const agg = new ApprenticeCorpusAggregator({
      memoryRoot: FIXTURE_MEMORY,
      reportsRoot: FIXTURE_REPORTS,
      outputRoot,
      distillEnabled: false,
      qualityThreshold: 0.0,
      eventBus: createFakeEventBus([]),
      github: createFakeGithub([]),
      langfuse: createFakeLangfuse([]),
      clock: () => new Date('2026-05-06T12:00:00Z')
    });
    const manifest = await agg.aggregate();
    const samplesText = readFileSync(
      join(outputRoot, '2026-05-06', 'samples.jsonl'),
      'utf-8'
    );
    // The fixture handoff contains a sk- key shape — verify it's redacted.
    // Credential-shape strings are runtime-constructed so static
    // secret-scanners (gitleaks, semgrep) don't flag this test file.
    const fixtureSecretShape = 'sk-' + 'abcdefghijklmnopqrstuvwxyz1234567890';
    expect(samplesText).not.toContain(fixtureSecretShape);
    expect(samplesText).toContain('[redacted-secret');
    // Email shape redaction — operator email appears in the fixture handoff
    const fixtureEmailLocal = 'prakash' + 'mailid';
    expect(samplesText).not.toContain(`${fixtureEmailLocal}@gmail.com`);
    expect(samplesText).toContain('[redacted-email]');
    // Path normalisation
    expect(samplesText).not.toContain('/Users/test-user/');
    // The redacted-spans histogram should record what fired
    expect(Object.keys(manifest.redactedSpansHistogram)).toContain('email');
    expect(Object.keys(manifest.redactedSpansHistogram)).toContain('secret');
  });

  it('routes low-quality samples through distiller when enabled', async () => {
    let distillCalls = 0;
    const fakeDistiller = createFakeDistiller(() => {
      distillCalls += 1;
      return {
        instruction: 'What is the rule?',
        response:
          '# Rule header\n\n- bullet one\n- bullet two\n\nA polished response that is structured, comfortably above the floor, and looks like the operator wrote it.\n\nMore text for additional length contribution.'
      };
    });

    const agg = new ApprenticeCorpusAggregator({
      memoryRoot: FIXTURE_MEMORY,
      reportsRoot: FIXTURE_REPORTS,
      outputRoot,
      distillEnabled: true,
      qualityThreshold: 0.99, // force every sample below threshold
      eventBus: createFakeEventBus([]),
      github: createFakeGithub([]),
      langfuse: createFakeLangfuse([]),
      claudeDistiller: fakeDistiller,
      clock: () => new Date('2026-05-06T12:00:00Z')
    });

    const manifest = await agg.aggregate();
    // We had memory + reports artifacts; all routed through distiller
    expect(distillCalls).toBeGreaterThan(0);
    expect(manifest.totals.distilled).toBeGreaterThan(0);
  });

  it('records langfuse=disabled state (Phase-0 stub posture)', async () => {
    const agg = new ApprenticeCorpusAggregator({
      memoryRoot: FIXTURE_MEMORY,
      reportsRoot: FIXTURE_REPORTS,
      outputRoot,
      distillEnabled: false,
      qualityThreshold: 0.0,
      langfuseEnabled: false, // explicit
      eventBus: createFakeEventBus([]),
      github: createFakeGithub([]),
      // even if langfuse client returns records, the reader skips when disabled
      langfuse: createFakeLangfuse([
        {
          id: 'should-not-appear',
          name: 'agent.run',
          input: 'x',
          output: 'y',
          createdAtMs: Date.now()
        }
      ]),
      clock: () => new Date('2026-05-06T12:00:00Z')
    });
    const manifest = await agg.aggregate();
    expect(manifest.perSource.langfuse.artifacts).toBe(0);
  });
});
