/**
 * The Promptfoo + DeepEval split.
 */

export type AssertionRouting = 'promptfoo' | 'deepeval' | 'either';

export interface AssertionTypeDescriptor {
  readonly type: string;
  readonly routing: AssertionRouting;
  readonly description: string;
}

export const ASSERTION_TYPES: ReadonlyArray<AssertionTypeDescriptor> = [
  { type: 'contains', routing: 'promptfoo', description: 'Substring check — fast, deterministic.' },
  { type: 'not-contains', routing: 'promptfoo', description: 'Negative substring check.' },
  { type: 'regex', routing: 'promptfoo', description: 'Regular expression match.' },
  { type: 'equals', routing: 'promptfoo', description: 'Exact string equality.' },
  { type: 'javascript', routing: 'promptfoo', description: 'Sandboxed JS predicate over the output.' },
  { type: 'semantic-similarity', routing: 'promptfoo', description: 'Cosine similarity via local nomic-embed-text.' },
  { type: 'hallucination', routing: 'deepeval', description: 'DeepEval HallucinationMetric — context-grounded hallucination detection.' },
  { type: 'faithfulness', routing: 'deepeval', description: 'DeepEval FaithfulnessMetric — RAG-output faithful-to-context check.' },
  { type: 'answer-relevancy', routing: 'deepeval', description: 'DeepEval AnswerRelevancyMetric.' },
  { type: 'g-eval', routing: 'deepeval', description: 'DeepEval G-Eval — chain-of-thought rubric scoring with explanations.' },
  { type: 'contextual-recall', routing: 'deepeval', description: 'DeepEval ContextualRecallMetric — RAG retrieval recall.' },
  { type: 'llm-rubric', routing: 'either', description: 'LLM-as-judge rubric. Promptfoo or DeepEval.' }
];

const _byType = new Map(ASSERTION_TYPES.map((a) => [a.type, a]));

export function getAssertionRouting(type: string): AssertionRouting | null {
  return _byType.get(type)?.routing ?? null;
}
