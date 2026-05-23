/**
 * `AIMLArchitectContract` — the canonical owned-fields declaration for
 * architect #7 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.7 (AI/ML Architect)
 *   - V2 operator brief 2026-05-23 (owned fields: modelSelection,
 *     promptPatterns, evalSuite, costAttribution, aiSafetyChecks,
 *     temperaturePresets, outputSchemas, cacheStrategy)
 *
 * The owned set below is the V2 operator-brief superset. Every field is
 * `required: true` because the AI/ML output gates the Test Author Agent
 * (it needs the eval suite + output schemas to write LLM-call tests) and
 * the Coding Worker (it needs the prompt patterns + model selection to
 * implement the LLM call).
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. The chosen keys all live under the `aiml.*`
 * namespace and do not collide with any sibling architect's namespace.
 *
 * Wave-1 architect: NO upstream deps in the EA graph (per V2 brief). The
 * AI/ML architect reads ticket business requirements + business plan
 * directly; it does not depend on Backend's framework choice for V1.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

/**
 * Per-field operator fix-hints. The kit's `ArchitectSectionSpec` is
 * intentionally minimal (`path`, `description`, `required`); the fix-hint
 * dictionary lives next to the contract so the system-prompt builder and
 * the future EA Reviewer can surface it without changing kit shape.
 */
export const AIML_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'aiml.modelSelection':
    'Pick per call type. Default to Claude Sonnet 4.6 for general; Haiku for classification/format/short reasoning; Opus for complex multi-step reasoning. Each entry: {callType, model, rationale, fallback}.',
  'aiml.promptPatterns':
    'Per call type: {systemPrompt, fewShotExamples[], userPromptTemplate, refusalPatterns[]}. System prompt declares role + constraints + output contract. Few-shot examples lifted verbatim from approved corpus; never invented.',
  'aiml.evalSuite':
    'Per call type: {evalCases[{input, expectedOutput, assertions[]}], passThreshold, metricKey}. Min 5 cases per call type. Assertions use Promptfoo-style strings (contains, regex, llm-rubric).',
  'aiml.costAttribution':
    'Per call type: {costClass (T1|T2|T3), expectedTokensIn, expectedTokensOut, dollarsPerCall, monthlyForecastUsd}. T1=<$0.001, T2=<$0.01, T3=<$0.10.',
  'aiml.aiSafetyChecks':
    'Required safety gates: {piiDetection, promptInjectionGuard, outputContentFilter, hallucinationGate, refusalAuditLog}. Each declares posture (block|warn|log) and where it fires (pre|post).',
  'aiml.temperaturePresets':
    'Per call type: {temperature, topP, maxOutputTokens, stopSequences[]}. Deterministic calls (classification, extraction) use 0.0; generative calls use 0.7. Document the choice.',
  'aiml.outputSchemas':
    'Per call type: Zod-style descriptor of the expected JSON shape returned by Claude. Includes nullable fields, enum values, array element types. The Coding Worker generates the Zod schema from this descriptor.',
  'aiml.cacheStrategy':
    'Per call type: {exact: ttlSeconds|null, semantic: {embeddingModel, similarityThreshold, ttlSeconds}|null}. Default exact-cache 24h for deterministic calls; semantic for prompt-template-stable variants.'
};

/**
 * The owned section specs in stable order.
 */
export const AIML_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'aiml.modelSelection',
    description:
      'Which Claude model (Haiku|Sonnet|Opus) per call type. Includes rationale and fallback model when the preferred one is unavailable.',
    required: true
  },
  {
    path: 'aiml.promptPatterns',
    description:
      'Per call type: system prompt body + few-shot examples + user-prompt template + refusal patterns. The Coding Worker emits these verbatim into the implementation.',
    required: true
  },
  {
    path: 'aiml.evalSuite',
    description:
      'Per call type: eval cases (input, expected output, assertions) + pass threshold + metric key. Minimum 5 cases per call type.',
    required: true
  },
  {
    path: 'aiml.costAttribution',
    description:
      'Per call type: cost class (T1/T2/T3), expected token counts, $/call, monthly forecast. Drives the Spend-Guard budget gates.',
    required: true
  },
  {
    path: 'aiml.aiSafetyChecks',
    description:
      'PII detection, prompt-injection guard, output content filter, hallucination gate, refusal audit log. Each declares posture (block|warn|log) and stage (pre|post).',
    required: true
  },
  {
    path: 'aiml.temperaturePresets',
    description:
      'Per call type: temperature, topP, maxOutputTokens, stopSequences. Deterministic calls use 0.0; generative calls 0.7.',
    required: true
  },
  {
    path: 'aiml.outputSchemas',
    description:
      'Per call type: Zod-style structured-output descriptor. Drives parser construction in the Coding Worker.',
    required: true
  },
  {
    path: 'aiml.cacheStrategy',
    description:
      'Per call type: exact-cache TTL and/or semantic-cache config (embedding model, similarity threshold, TTL). Default 24h exact-cache for deterministic calls.',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const AIML_OWNED_FIELD_KEYS: readonly string[] = AIML_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * V2 brief: AI/ML applies whenever the ticket touches AI/LLM concerns —
 * business requirements reference AI/LLM/chatbot/recommendation/search,
 * OR the ticket carries an explicit `ai` quality tag, OR the ticket type
 * is a known AI-touching type. Conservative — false-positives are cheap
 * (the architect's run() is cheap to skip via empty output).
 */
const AI_KEYWORDS = [
  'ai',
  'llm',
  'gpt',
  'claude',
  'chatbot',
  'chat bot',
  'recommendation',
  'recommender',
  'search',
  'embedding',
  'vector',
  'rag',
  'prompt',
  'generative',
  'classifier',
  'classification'
];

export function aimlArchitectAppliesPredicate(ticket: Ticket): boolean {
  // 1. Explicit quality tag.
  const qualityTags = (ticket.quality_tags ?? []) as readonly string[];
  if (qualityTags.includes('ai') || qualityTags.includes('ml') || qualityTags.includes('llm')) {
    return true;
  }

  // 2. Known AI-touching ticket type.
  if (ticket.type === 'AICall' || ticket.type === 'LLMFlow' || ticket.type === 'AIWidget') {
    return true;
  }

  // 3. Keyword scan over business requirements (free-form blob).
  const blob = JSON.stringify(ticket.business_requirements ?? {}).toLowerCase();
  for (const kw of AI_KEYWORDS) {
    // Word-boundary match for the short keywords; substring for the long ones.
    if (kw.length <= 3) {
      const re = new RegExp(`\\b${kw}\\b`, 'i');
      if (re.test(blob)) return true;
    } else if (blob.includes(kw)) {
      return true;
    }
  }

  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * AI/ML is a wave-1 architect per V2 brief (`dependsOn: []`). Precedence
 * rank 13 per spec §5.2 — deliberately above Frontend (cost/quality
 * tradeoffs matter more to operator-experience than visual fidelity) and
 * below the safety/operability ladder (security, devops, a11y, seo, perf).
 */
export const AIML_ARCHITECT_META: ArchitectMeta = {
  dependsOn: [],
  precedenceLevel: 13,
  fanoutPolicy: 'always',
  appliesPredicate: aimlArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const AIMLArchitectContract: ArchitectSectionContract = {
  contractId: 'aiml-architect.v1',
  architectName: 'ai-ml',
  version: '0.1.0',
  sections: AIML_OWNED_SECTIONS,
  architectMeta: AIML_ARCHITECT_META
};
