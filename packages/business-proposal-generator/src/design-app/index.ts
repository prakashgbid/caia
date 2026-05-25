/** @caia/business-proposal-generator/design-app — public subsurface. */

export type { IDesignAppPromptGenerator, GeneratorRenderInput, GeneratorConfig } from './generator-interface.js';
export { TargetRegistry } from './registry.js';
export { parseDesignAppPromptOutput, designAppPromptOutputSchema } from './envelope.js';
export { buildDeepLink, supportsInlinePrompt } from './deep-links.js';

export { ClaudeDesignGenerator } from './targets/claude-design.js';
export { StubGenerator } from './targets/stub-base.js';
export { FigmaGenerator } from './targets/figma.js';
export { V0Generator } from './targets/v0.js';
export { LovableGenerator } from './targets/lovable.js';
export { BoltGenerator } from './targets/bolt.js';
export { BuilderioGenerator } from './targets/builderio.js';
export { WebflowGenerator } from './targets/webflow.js';

import { TargetRegistry } from './registry.js';
import { ClaudeDesignGenerator } from './targets/claude-design.js';
import { FigmaGenerator } from './targets/figma.js';
import { V0Generator } from './targets/v0.js';
import { LovableGenerator } from './targets/lovable.js';
import { BoltGenerator } from './targets/bolt.js';
import { BuilderioGenerator } from './targets/builderio.js';
import { WebflowGenerator } from './targets/webflow.js';
import type { LlmCaller } from '../llm.js';

/** Build a registry pre-populated with all 7 V1 generators (CD real, 6 stubs). */
export function buildDefaultRegistry(opts: { llmCaller: LlmCaller; skillsRoot: string }): TargetRegistry {
  const reg = new TargetRegistry();
  reg.register(new ClaudeDesignGenerator({ llmCaller: opts.llmCaller, skillsRoot: opts.skillsRoot }));
  reg.register(new FigmaGenerator({ skillsRoot: opts.skillsRoot }));
  reg.register(new V0Generator({ skillsRoot: opts.skillsRoot }));
  reg.register(new LovableGenerator({ skillsRoot: opts.skillsRoot }));
  reg.register(new BoltGenerator({ skillsRoot: opts.skillsRoot }));
  reg.register(new BuilderioGenerator({ skillsRoot: opts.skillsRoot }));
  reg.register(new WebflowGenerator({ skillsRoot: opts.skillsRoot }));
  return reg;
}
