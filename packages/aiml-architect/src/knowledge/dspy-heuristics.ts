/**
 * Heuristic for "should we DSPy-compile this prompt template?"
 */

export interface DspyCompileSignals {
  readonly highFrequency: boolean;
  readonly reliabilitySensitive: boolean;
  readonly crossModelPortable: boolean;
}

export interface DspyCompileVerdict {
  readonly recommend: boolean;
  readonly reason: string;
  readonly signalsPresent: ReadonlyArray<keyof DspyCompileSignals>;
}

const HIGH_FREQUENCY_TASK_CATEGORIES = new Set<string>([
  'domain-classification',
  'nature-classification',
  'embedding-generation',
  'dedup-check',
  'commit-message',
  'pr-summary',
  'code-explanation',
  'po-decomposer-scope-detection',
  'po-decomposer-atomicity-classification',
  'requirement-deduplication'
]);

const RELIABILITY_SENSITIVE_TASK_CATEGORIES = new Set<string>([
  'po-decomposer-coverage-judge',
  'po-decomposer-disjointness-judge',
  'security-review',
  'architecture-decision',
  'code-review-light'
]);

const CROSS_MODEL_PORTABLE_TASK_CATEGORIES = new Set<string>([
  'code-implementation-simple',
  'code-implementation-complex',
  'test-generation-simple',
  'po-decomposer-initiative',
  'po-decomposer-epic',
  'po-decomposer-module',
  'po-decomposer-story',
  'hierarchy-decomposition'
]);

export function detectSignals(taskCategory: string): DspyCompileSignals {
  return {
    highFrequency: HIGH_FREQUENCY_TASK_CATEGORIES.has(taskCategory),
    reliabilitySensitive:
      RELIABILITY_SENSITIVE_TASK_CATEGORIES.has(taskCategory),
    crossModelPortable: CROSS_MODEL_PORTABLE_TASK_CATEGORIES.has(taskCategory)
  };
}

export function decideDspyCompile(
  taskCategory: string
): DspyCompileVerdict {
  const signals = detectSignals(taskCategory);
  const present: Array<keyof DspyCompileSignals> = [];
  if (signals.highFrequency) present.push('highFrequency');
  if (signals.reliabilitySensitive) present.push('reliabilitySensitive');
  if (signals.crossModelPortable) present.push('crossModelPortable');

  if (present.length >= 2) {
    return {
      recommend: true,
      reason:
        `Task ${taskCategory} matches ${present.length} of 3 DSPy-compile signals: ` +
        present.join(', ') +
        '. Compile cost (100-500 LLM calls) amortises within a single day.',
      signalsPresent: present
    };
  }

  return {
    recommend: false,
    reason:
      `Task ${taskCategory} matches only ${present.length} of 3 DSPy-compile signals. ` +
      'Manual prompt + canonical eval suite is sufficient.',
    signalsPresent: present
  };
}
