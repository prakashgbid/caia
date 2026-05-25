import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ScriptedLlmCaller } from '../src/llm.js';
import { ProposalGenerator } from '../src/orchestrator.js';
import { MemoryBlobStorage } from '../src/storage/memory-blob.js';
import { MemoryProposalPersistence } from '../src/storage/postgres.js';
import { sampleIa, samplePlan } from './fixtures/sample-plan.js';

async function buildSkillsTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'caia-bpg-orch-'));
  const cd = join(root, 'claude-design');
  await mkdir(cd, { recursive: true });
  await writeFile(join(cd, 'SKILL.md'), 'CD skill body.', 'utf8');
  return root;
}

const fullMd = (): string => '# T\n## A\n## B\n## C\n## D\n' + Array(3000).fill('word').join(' ');
const execMd = (): string => '# Exec\n' + Array(120).fill('word').join(' ');
const oneMd = (): string => '## A\n' + Array(80).fill('word').join(' ');

const envJ = (): string => JSON.stringify({
  target: 'claude_design',
  prompt_text: '# brief',
  prompt_files: [],
  prompt_metadata: {
    palette: { paper: '#FFFFFF', ink: '#0F172A', accent: '#0E7490' },
    type_pairing: { display: 'Fraunces', body: 'Inter' },
    accent_options: [], layout_patterns: ['editorial'], reference_urls: [],
    motion_preference: 'restrained', platform_strategy: 'pwa-only',
  },
  instructions_for_customer: 'Paste into claude.ai.',
});

const revJ = (s: number): string => JSON.stringify({
  composite_score: s,
  dimensions: { coverage: s, specificity: s, target_fit: s, creativity_surface: s, no_drift: s, polish: s },
  findings: [],
  recommendation: s >= 70 ? 'ship' : 'retry',
});

const TENANT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

describe('ProposalGenerator.runStep5', () => {
  it('end-to-end happy path: 3 docs + 1 prompt + reviewer ship', async () => {
    const skillsRoot = await buildSkillsTree();
    const caller = new ScriptedLlmCaller([
      { kind: 'ok', text: execMd() },
      { kind: 'ok', text: fullMd() },
      { kind: 'ok', text: oneMd() },
      { kind: 'ok', text: envJ() },
      { kind: 'ok', text: revJ(85) },
    ]);
    const blob = new MemoryBlobStorage();
    const persist = new MemoryProposalPersistence();
    const gen = new ProposalGenerator({
      llmCaller: caller, blobStorage: blob, persistence: persist, skillsRoot, skipFormatConversion: true,
    });
    const out = await gen.runStep5({ tenantProjectId: TENANT, plan: samplePlan(88), ia: sampleIa() });
    expect(out.cacheHit).toBe(false);
    expect(out.reviewerBadge).toBe('ship');
    expect(persist.listProposals().length).toBe(1);
    expect(persist.listPrompts().length).toBe(1);
    expect(persist.listRevisions().length).toBe(1);
  });

  it('retry path: first reviewer < 70 triggers one retry, second ships', async () => {
    const skillsRoot = await buildSkillsTree();
    const caller = new ScriptedLlmCaller([
      { kind: 'ok', text: execMd() },
      { kind: 'ok', text: fullMd() },
      { kind: 'ok', text: oneMd() },
      { kind: 'ok', text: envJ() },
      { kind: 'ok', text: revJ(50) },
      { kind: 'ok', text: envJ() },
      { kind: 'ok', text: revJ(85) },
    ]);
    const gen = new ProposalGenerator({
      llmCaller: caller, blobStorage: new MemoryBlobStorage(),
      persistence: new MemoryProposalPersistence(), skillsRoot, skipFormatConversion: true,
    });
    const out = await gen.runStep5({ tenantProjectId: TENANT, plan: samplePlan(88), ia: sampleIa() });
    expect(out.reviewerBadge).toBe('ship');
  });

  it('caution path: second reviewer still < 70 ships with caution', async () => {
    const skillsRoot = await buildSkillsTree();
    const caller = new ScriptedLlmCaller([
      { kind: 'ok', text: execMd() }, { kind: 'ok', text: fullMd() }, { kind: 'ok', text: oneMd() },
      { kind: 'ok', text: envJ() }, { kind: 'ok', text: revJ(50) },
      { kind: 'ok', text: envJ() }, { kind: 'ok', text: revJ(55) },
    ]);
    const gen = new ProposalGenerator({
      llmCaller: caller, blobStorage: new MemoryBlobStorage(),
      persistence: new MemoryProposalPersistence(), skillsRoot, skipFormatConversion: true,
    });
    const out = await gen.runStep5({ tenantProjectId: TENANT, plan: samplePlan(88), ia: sampleIa() });
    expect(out.reviewerBadge).toBe('caution');
  });

  it('cache hit: identical plan + ia → no new LLM calls', async () => {
    const skillsRoot = await buildSkillsTree();
    const persist = new MemoryProposalPersistence();
    const blob = new MemoryBlobStorage();
    const caller1 = new ScriptedLlmCaller([
      { kind: 'ok', text: execMd() }, { kind: 'ok', text: fullMd() }, { kind: 'ok', text: oneMd() },
      { kind: 'ok', text: envJ() }, { kind: 'ok', text: revJ(85) },
    ]);
    const gen1 = new ProposalGenerator({
      llmCaller: caller1, blobStorage: blob, persistence: persist, skillsRoot, skipFormatConversion: true,
    });
    await gen1.runStep5({ tenantProjectId: TENANT, plan: samplePlan(88), ia: sampleIa() });
    const caller2 = new ScriptedLlmCaller([]);
    const gen2 = new ProposalGenerator({
      llmCaller: caller2, blobStorage: blob, persistence: persist, skillsRoot, skipFormatConversion: true,
    });
    const out = await gen2.runStep5({ tenantProjectId: TENANT, plan: samplePlan(88), ia: sampleIa() });
    expect(out.cacheHit).toBe(true);
    expect(caller2.callCount()).toBe(0);
    expect(persist.listProposals().length).toBe(1);
  });

  it('refuses plans with aggregate score < 80', async () => {
    const skillsRoot = await buildSkillsTree();
    const gen = new ProposalGenerator({
      llmCaller: new ScriptedLlmCaller([]),
      blobStorage: new MemoryBlobStorage(),
      persistence: new MemoryProposalPersistence(),
      skillsRoot, skipFormatConversion: true,
    });
    await expect(
      gen.runStep5({ tenantProjectId: TENANT, plan: samplePlan(70), ia: sampleIa() }),
    ).rejects.toMatchObject({ code: 'plan_score_below_threshold' });
  });

  it('calls the fsmAdvance hook on success', async () => {
    const skillsRoot = await buildSkillsTree();
    let advanced = false;
    const gen = new ProposalGenerator({
      llmCaller: new ScriptedLlmCaller([
        { kind: 'ok', text: execMd() }, { kind: 'ok', text: fullMd() }, { kind: 'ok', text: oneMd() },
        { kind: 'ok', text: envJ() }, { kind: 'ok', text: revJ(85) },
      ]),
      blobStorage: new MemoryBlobStorage(),
      persistence: new MemoryProposalPersistence(),
      skillsRoot, skipFormatConversion: true,
      fsmAdvance: async () => { advanced = true; },
    });
    await gen.runStep5({ tenantProjectId: TENANT, plan: samplePlan(88), ia: sampleIa() });
    expect(advanced).toBe(true);
  });
});
