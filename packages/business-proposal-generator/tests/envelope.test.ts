import { describe, expect, it } from 'vitest';

import { ProposalGeneratorError } from '../src/errors.js';
import { parseDesignAppPromptOutput } from '../src/design-app/envelope.js';
import type { DesignAppPromptOutput } from '../src/types/design-app.js';

function validEnvelope(): DesignAppPromptOutput {
  return {
    target: 'claude_design',
    prompt_text: 'Long brief.',
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
  };
}

describe('DesignAppPromptOutput envelope', () => {
  it('parses a valid envelope', () => {
    const out = parseDesignAppPromptOutput(validEnvelope());
    expect(out.target).toBe('claude_design');
  });

  it('rejects missing target', () => {
    const bad = { ...validEnvelope() } as Record<string, unknown>;
    delete bad.target;
    expect(() => parseDesignAppPromptOutput(bad)).toThrow(ProposalGeneratorError);
  });

  it('rejects unknown target', () => {
    const bad = { ...validEnvelope(), target: 'photoshop' };
    expect(() => parseDesignAppPromptOutput(bad)).toThrow(ProposalGeneratorError);
  });

  it('rejects unknown fields (strict)', () => {
    const bad = { ...validEnvelope(), nonsense_field: 'x' };
    expect(() => parseDesignAppPromptOutput(bad)).toThrow(ProposalGeneratorError);
  });

  it('rejects empty prompt_text', () => {
    const bad = { ...validEnvelope(), prompt_text: '' };
    expect(() => parseDesignAppPromptOutput(bad)).toThrow();
  });

  it('accepts every target name in TargetName enum', () => {
    for (const t of ['figma', 'v0', 'lovable', 'bolt', 'builderio', 'webflow'] as const) {
      const out = parseDesignAppPromptOutput({ ...validEnvelope(), target: t });
      expect(out.target).toBe(t);
    }
  });
});
