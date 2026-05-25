import { describe, expect, it } from 'vitest';

import { ProposalGeneratorError } from '../src/errors.js';
import { TargetRegistry } from '../src/design-app/registry.js';
import { ClaudeDesignGenerator } from '../src/design-app/targets/claude-design.js';
import { FigmaGenerator } from '../src/design-app/targets/figma.js';
import { ScriptedLlmCaller } from '../src/llm.js';

describe('TargetRegistry', () => {
  it('returns a generator by name', () => {
    const reg = new TargetRegistry();
    reg.register(
      new ClaudeDesignGenerator({
        llmCaller: new ScriptedLlmCaller([]),
        skillsRoot: '/tmp/skills',
      }),
    );
    expect(reg.get('claude_design').target).toBe('claude_design');
  });

  it('throws not_implemented for unknown target', () => {
    const reg = new TargetRegistry();
    expect(() => reg.get('figma')).toThrow(ProposalGeneratorError);
  });

  it('throws on duplicate registration', () => {
    const reg = new TargetRegistry();
    reg.register(new FigmaGenerator({ skillsRoot: '/tmp/skills' }));
    expect(() =>
      reg.register(new FigmaGenerator({ skillsRoot: '/tmp/skills' })),
    ).toThrow(ProposalGeneratorError);
  });

  it('lookup() returns undefined for unknown name without throwing', () => {
    const reg = new TargetRegistry();
    expect(reg.lookup('nope')).toBeUndefined();
  });

  it('listTargets returns registered targets', () => {
    const reg = new TargetRegistry();
    reg.register(new FigmaGenerator({ skillsRoot: '/tmp/skills' }));
    expect(reg.listTargets()).toContain('figma');
  });
});
