export interface DecompositionNode {
  id: string;
  level: 'initiative' | 'epic' | 'module' | 'story' | 'task';
  title: string;
  description: string;
  acceptanceCriteria?: string[];
  estimatedEffort?: 'trivial' | 'small' | 'medium' | 'large' | 'xl';
  dependencies?: string[];  // IDs of other nodes this depends on
  canParallelize?: boolean;
  children?: DecompositionNode[];
  metadata?: Record<string, unknown>;
}

export interface DecompositionResult {
  promptId?: string;
  originalPrompt: string;
  hierarchy: DecompositionNode[];  // top-level initiatives
  totalNodes: number;
  estimatedDays: number;
  recommendedParallelTracks: number;
  summary: string;
}

export interface DecomposerConfig {
  maxDepth?: number;          // default: 5 (initiative→epic→module→story→task)
  minStoriesPerEpic?: number; // default: 2
  maxStoriesPerEpic?: number; // default: 8
  aiProvider?: 'claude' | 'rule-based';  // rule-based for testing/cost savings
  claudeApiKey?: string;
  claudeModel?: string;       // default: claude-sonnet-4-6
  /**
   * Cap on the number of logical sections the rule-based decomposer
   * will produce per prompt. Each section becomes one Epic; uncapped
   * very-long prompts (>4 KB) produced 2000+ descendants in the
   * 2026-04-30 audit. Defaults to 20. Also overridable via
   * DECOMPOSER_MAX_SECTIONS env var. Excess sections are coalesced
   * into the final retained section so no prompt content is lost.
   */
  maxSections?: number;
}
