/** IDesignAppPromptGenerator interface. Each target generator implements this. */

import type { IaArtifactSet } from '../types/ia.js';
import type {
  BusinessPlanV2,
  TargetName,
} from '../types/proposal.js';
import type { DesignAppPromptOutput } from '../types/design-app.js';
import type { LlmCaller } from '../llm.js';

export interface GeneratorRenderInput {
  plan: BusinessPlanV2;
  ia: IaArtifactSet;
  tenantContext?: Readonly<Record<string, unknown>>;
  /** Feedback from a prior reviewer pass (for the one-retry path). */
  previousFindings?: Readonly<Record<string, unknown>>;
}

export interface IDesignAppPromptGenerator {
  readonly target: TargetName;
  readonly skillPath: string;
  render(input: GeneratorRenderInput): Promise<DesignAppPromptOutput>;
}

export interface GeneratorConfig {
  llmCaller: LlmCaller;
  skillsRoot: string;
}
