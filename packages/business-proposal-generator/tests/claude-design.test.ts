import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ScriptedLlmCaller } from '../src/llm.js';
import { ClaudeDesignGenerator } from '../src/design-app/targets/claude-design.js';
import { sampleIa, samplePlan } from './fixtures/sample-plan.js';

async function buildSkillsTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'caia-bpg-skills-'));
  const cd = join(root, 'claude-design');
  await mkdir(cd, { recursive: true });
  await writeFile(join(cd, 'SKILL.md'), 'CD skill body for tests.', 'utf8');
  await writeFile(join(cd, 'template.md'), '## Template\n{{PROJECT_NAME}}', 'utf8');
  return root;
}

function envelopeJson(): string {
  return JSON.stringify({
    target: 'claude_design',
    prompt_text: '# Brief\nA brief.',
    prompt_files: [],
    prompt_metadata: {
      palette: { paper: '#FFFFFF', ink: '#0F172A', accent: '#0E7490' },
      type_pairing: { display: 'Fraunces', body: 'Inter' },
      accent_options: [],
      layout_patterns: ['editorial'],
      reference_urls: [],
      motion_preference: 'restrained',
      platform_strategy: 'pwa-only',
    },
    instructions_for_customer: 'Paste into claude.ai.',
  });
}

describe('ClaudeDesignGenerator', () => {
  it('loads the skill and returns a valid envelope', async () => {
    const skillsRoot = await buildSkillsTree();
    const caller = new ScriptedLlmCaller([{ kind: 'ok', text: envelopeJson() }]);
    const g = new ClaudeDesignGenerator({ llmCaller: caller, skillsRoot });
    const out = await g.render({ plan: samplePlan(), ia: sampleIa() });
    expect(out.target).toBe('claude_design');
    expect(out.deep_link_url).toMatch(/^https:\/\/claude\.ai\/new\?q=/);
  });

  it('throws envelope_invalid on a malformed LLM response', async () => {
    const skillsRoot = await buildSkillsTree();
    const caller = new ScriptedLlmCaller([
      { kind: 'ok', text: '{"target":"figma","prompt_text":"x","prompt_metadata":{}}' },
    ]);
    const g = new ClaudeDesignGenerator({ llmCaller: caller, skillsRoot });
    await expect(g.render({ plan: samplePlan(), ia: sampleIa() })).rejects.toMatchObject({
      code: 'envelope_invalid',
    });
  });

  it('propagates llm_call_failed when the LLM call fails', async () => {
    const skillsRoot = await buildSkillsTree();
    const caller = new ScriptedLlmCaller([{ kind: 'fail', diagnostic: 'simulated' }]);
    const g = new ClaudeDesignGenerator({ llmCaller: caller, skillsRoot });
    await expect(g.render({ plan: samplePlan(), ia: sampleIa() })).rejects.toMatchObject({
      code: 'llm_call_failed',
    });
  });

  it('throws when SKILL.md is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'caia-bpg-skills-'));
    await mkdir(join(root, 'claude-design'), { recursive: true });
    const caller = new ScriptedLlmCaller([{ kind: 'ok', text: envelopeJson() }]);
    const g = new ClaudeDesignGenerator({ llmCaller: caller, skillsRoot: root });
    await expect(g.render({ plan: samplePlan(), ia: sampleIa() })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});
