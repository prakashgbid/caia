/**
 * Top-level AIMLArchitect orchestration.
 */

import {
  resolveConfig,
  type AIMLArchitectConfig,
  type ResolvedAIMLArchitectConfig
} from './config.js';
import { createDefaultAdapterRegistry } from './adapter-registry.js';
import { coordinateApprenticeLoop } from './coordinate-apprentice-loop.js';
import { createDefaultCuratorReader } from './curator-bridge.js';
import { defaultFsReader } from './fs-reader.js';
import { createDefaultMentorReader } from './mentor-bridge.js';
import { ownEvalSuite } from './own-eval-suite.js';
import { reviewPromptPattern } from './review-prompt-pattern.js';
import { selectModel } from './select-model.js';
import { generateConventionDoc } from './convention-doc-generator.js';
import type {
  AdapterRegistryReader,
  CuratorReader,
  EvalSuite,
  FsReader,
  MentorReader,
  ModelChoice,
  ReviewPromptPatternParams,
  ReviewResult,
  SelectModelParams,
  TrainingPlan
} from './types.js';

export class AIMLArchitect {
  private readonly cfg: ResolvedAIMLArchitectConfig;
  private readonly fs: FsReader;
  private readonly mentor: MentorReader;
  private readonly curator: CuratorReader;
  private readonly adapterRegistry: AdapterRegistryReader;
  private readonly clock: () => Date;

  constructor(input: AIMLArchitectConfig = {}) {
    this.cfg = resolveConfig(input);
    this.fs = input.fs ?? defaultFsReader;
    this.mentor =
      input.mentor ??
      createDefaultMentorReader({ dbPath: this.cfg.mentorEventsDbPath });
    this.curator =
      input.curator ??
      createDefaultCuratorReader({ scanRoot: this.cfg.curatorScanRoot });
    this.adapterRegistry =
      input.adapterRegistry ??
      createDefaultAdapterRegistry({
        registryRoot: this.cfg.apprenticeAdapterRegistryRoot
      });
    this.clock = input.clock ?? ((): Date => new Date());
  }

  config(): ResolvedAIMLArchitectConfig {
    return this.cfg;
  }

  selectModel(params: SelectModelParams): ModelChoice {
    return selectModel(params, {
      cfg: this.cfg,
      adapterRegistry: this.adapterRegistry
    });
  }

  reviewPromptPattern(params: ReviewPromptPatternParams): ReviewResult {
    return reviewPromptPattern(params);
  }

  ownEvalSuite(): EvalSuite {
    return ownEvalSuite({
      cfg: this.cfg,
      fs: this.fs,
      clock: this.clock
    });
  }

  coordinateApprenticeLoop(): TrainingPlan {
    return coordinateApprenticeLoop({
      cfg: this.cfg,
      mentor: this.mentor,
      curator: this.curator,
      adapterRegistry: this.adapterRegistry,
      clock: this.clock
    });
  }

  generateConventionsDoc(): string {
    return generateConventionDoc({
      generatedAtIso: this.clock().toISOString(),
      canonicalSuitePath: this.cfg.canonicalSuitePath
    });
  }
}
