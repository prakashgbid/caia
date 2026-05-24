/**
 * EA Architect critic — wraps the LLM call.
 *
 * The agent reviews PLATFORM-LEVEL plans against the EA Repository.
 * Production spawns Claude via @chiefaia/claude-spawner (subscription-only
 * per P1 + P14). Tests substitute a deterministic adapter via the
 * `CriticAdapter` seam.
 *
 * The system prompt is critic-style: "defend the existing architecture
 * against drift; welcome justified change but resist arbitrary divergence."
 * This matches the @chiefaia/critic pattern (adversarial reviewer that
 * looks for misalignment with documented principles) but the lens is EA
 * (principles + ADRs + lessons) rather than per-PR diff failure-modes.
 */

import { spawnClaude } from '@chiefaia/claude-spawner';

import type {
  AffectedAdr,
  CriticAdapter,
  CriticInput,
  CriticOutput,
  ModelTier,
  NewAdrDraft,
  RelevantContext,
  ReviewStatus
} from './types.js';

/**
 * The critic-style system prompt the EA Architect Agent uses.
 *
 * Authored against the operator's directive verbatim (2026-05-23):
 * the agent is "the enterprise architect that defends the existing
 * architecture; you welcome justified change but resist arbitrary
 * divergence." Adversarial-but-fair: it must surface why a plan might
 * violate a principle or supersede an ADR, but it must also approve
 * cleanly when the plan is sound.
 */
export const EA_ARCHITECT_SYSTEM_PROMPT = `You are the EA Architect Agent — CAIA's Enterprise Architect at the platform level. You review research / spec / implementation / architecture-change / process-change plans BEFORE they reach the human operator. Your job is twofold:

1. DEFEND the existing architecture. Every plan is checked against CAIA's 12 architecture principles, 61+ ADRs, lessons-learned, and risk register. You surface principle violations, ADR conflicts, lessons the proposer ignored.

2. WELCOME justified change. You are not a rubber-stamp obstructionist. When a plan is sound — when it respects the principles, cites the right ADRs, addresses the risks — you approve cleanly and draft the ADR that captures the new decision.

Your verdict is ONE of: "approved", "approved-with-modifications", "rejected", "needs-clarification".

CRITICAL: never approve a plan without:
- Citing the principles + ADRs you checked it against (use exact ids: P9, ADR-015, etc).
- Identifying any new ADRs the decision requires (you draft them; the proposer does not).
- Naming any superseded ADRs and the action (amend vs supersede).
- Surfacing escalation to the operator ONLY for genuinely-strategic decisions: product pivots, billing-model changes, fundamental architecture reversals, security posture changes, principle amendments. Routine technical approvals are NEVER escalated.

OUTPUT STRICT JSON — no markdown fences, no prose preamble — with this shape:
{
  "status": "approved" | "approved-with-modifications" | "rejected" | "needs-clarification",
  "reasoning": "short paragraph (3-6 sentences) explaining the verdict",
  "cited_adrs": ["ADR-015", "ADR-029"],
  "cited_principles": ["P1", "P9"],
  "cited_lessons": ["03-policy-classifier-false-positives"],
  "requested_modifications": ["..."],
  "new_adrs_to_file": [
    {
      "title": "Title in present-tense verb phrase",
      "status": "Accepted",
      "context": "Why this decision is being made",
      "decision": "What we will do",
      "consequences": "Positive / negative / neutral consequences",
      "supersedes": ["ADR-060"],
      "affectedComponents": ["@caia/x"],
      "reversibility": "Reversible" | "One-way" | "Irreversible",
      "decisionMakers": "EA Architect Agent"
    }
  ],
  "affected_existing_adrs": [
    { "adrId": "ADR-060", "action": "supersede", "reason": "..." }
  ],
  "escalation_to_operator": null OR {
    "reason": "...",
    "decisionPoint": "...",
    "recommendation": "...",
    "category": "product-pivot" | "billing-model-change" | "fundamental-architecture-reversal" | "security-posture-change" | "principle-amendment" | "strategic-direction-change"
  }
}`;

/** Build the prompt that includes the EA Repository slice as authoritative context. */
export function buildCriticPrompt(input: CriticInput): string {
  const ctx = input.context;
  const principlesBlock = ctx.principles
    .map(
      (m) =>
        `### ${m.item.id} — ${m.item.title}\n${m.item.body.split('\n').slice(0, 12).join('\n').trim()}`
    )
    .join('\n\n');
  const adrsBlock = ctx.adrs
    .map((m) => `### ${m.item.adrId} — ${m.item.title}\nStatus: ${m.item.status}\n${truncate(m.item.body, 1200)}`)
    .join('\n\n');
  const lessonsBlock = ctx.lessons
    .map((m) => `### ${m.item.id} — ${m.item.title}\n${truncate(m.item.body, 600)}`)
    .join('\n\n');
  const risksBlock = ctx.risks
    .map((m) => `### ${m.item.id} — ${m.item.category}\n${truncate(m.item.body, 400)}`)
    .join('\n\n');
  const feedbackBlock = ctx.feedback
    .map((m) => `### [[${m.item.id}]]\n${truncate(m.item.body, 600)}`)
    .join('\n\n');

  return `${EA_ARCHITECT_SYSTEM_PROMPT}

## Iteration

This is iteration ${input.iteration} of the review cycle. Iteration 1 is the proposer's first submission; iteration N > 1 means they revised based on prior modification requests.

## EA Repository — Authoritative Context

### Architecture Principles (apply ALL of these)
${principlesBlock || '(none loaded)'}

### Relevant ADRs (topic-selected)
${adrsBlock || '(none matched)'}

### Lessons Learned (relevant)
${lessonsBlock || '(none matched)'}

### Risk Register (relevant)
${risksBlock || '(none matched)'}

### Operator Feedback Memories (always apply)
${feedbackBlock || '(none loaded)'}

## Plan Under Review

- planType: ${input.planType}
- affectedComponents: ${input.affectedComponents.join(', ') || '(none specified)'}

\`\`\`markdown
${input.planMarkdown}
\`\`\`

## Output JSON now:`;
}

function truncate(text: string, n: number): string {
  if (text.length <= n) return text;
  return text.slice(0, n) + '…';
}

/**
 * Default critic adapter — spawns Claude via @chiefaia/claude-spawner.
 * Subscription-only (no API key) by construction.
 */
export function createDefaultCritic(opts: {
  binaryPath?: string;
  timeoutMs?: number;
} = {}): CriticAdapter {
  return {
    async review(input: CriticInput): Promise<CriticOutput> {
      const prompt = buildCriticPrompt(input);
      const model = pickModel(input.modelTier);
      const result = await spawnClaude({
        prompt,
        options: {
          ...(opts.binaryPath !== undefined ? { binaryPath: opts.binaryPath } : {}),
          model,
          timeoutMs: opts.timeoutMs ?? 90_000
        }
      });
      if (!result.ok) {
        return emptyOutput('rejected', `claude spawn failed: ${result.diagnostic ?? 'unknown'}`);
      }
      return parseCriticOutput(result.stdout);
    }
  };
}

function pickModel(tier: ModelTier): string {
  return tier === 'opus' ? 'opus' : 'sonnet';
}

/** Parse JSON envelope from the model. Resilient to wrapping. */
export function parseCriticOutput(raw: string): CriticOutput {
  const json = extractJsonObject(raw);
  if (json === null) {
    return emptyOutput('rejected', 'no JSON object found in model output');
  }
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    return normaliseOutput(parsed);
  } catch (e) {
    return emptyOutput('rejected', `JSON parse error: ${(e as Error).message}`);
  }
}

/**
 * Find the outermost JSON object in a possibly-wrapped string. Supports:
 *   - the raw object
 *   - the object inside ```json fences
 *   - the object inside a claude --output-format json envelope
 */
function extractJsonObject(raw: string): string | null {
  // 1. claude --output-format json envelope: { ..., "result": "<json-string>" }
  try {
    const envelope = JSON.parse(raw) as { result?: string };
    if (envelope && typeof envelope === 'object' && typeof envelope.result === 'string') {
      const inner = findFirstObject(envelope.result);
      if (inner !== null) return inner;
    }
  } catch {
    // not an envelope, continue
  }
  // 2. fenced code block
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence !== null && fence[1] !== undefined) {
    const inner = findFirstObject(fence[1]);
    if (inner !== null) return inner;
  }
  // 3. raw
  return findFirstObject(raw);
}

function findFirstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

const VALID_STATUSES: readonly ReviewStatus[] = [
  'approved',
  'approved-with-modifications',
  'rejected',
  'needs-clarification'
];

function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

function normaliseOutput(raw: Record<string, unknown>): CriticOutput {
  const status = isReviewStatus(raw['status']) ? raw['status'] : 'needs-clarification';
  const reasoning = typeof raw['reasoning'] === 'string' ? raw['reasoning'] : '';
  const cited_adrs = asStringArray(raw['cited_adrs']);
  const cited_principles = asStringArray(raw['cited_principles']);
  const cited_lessons = asStringArray(raw['cited_lessons']);
  const requested_modifications = asStringArray(raw['requested_modifications']);
  const new_adrs_to_file = asAdrDraftArray(raw['new_adrs_to_file']);
  const affected_existing_adrs = asAffectedAdrArray(raw['affected_existing_adrs']);
  const esc = raw['escalation_to_operator'];
  let escalation_to_operator: CriticOutput['escalation_to_operator'];
  if (esc !== null && esc !== undefined && typeof esc === 'object') {
    const e = esc as Record<string, unknown>;
    escalation_to_operator = {
      reason: typeof e['reason'] === 'string' ? e['reason'] : '',
      decisionPoint: typeof e['decisionPoint'] === 'string' ? e['decisionPoint'] : '',
      ...(typeof e['recommendation'] === 'string' ? { recommendation: e['recommendation'] } : {}),
      ...(typeof e['category'] === 'string'
        ? { category: e['category'] as CriticOutput['escalation_to_operator'] extends infer R ? R extends { category?: infer C } ? C : never : never }
        : {})
    };
  }
  return {
    status,
    reasoning,
    cited_adrs,
    cited_principles,
    cited_lessons,
    requested_modifications,
    new_adrs_to_file,
    affected_existing_adrs,
    ...(escalation_to_operator !== undefined ? { escalation_to_operator } : {}),
    ok: true
  };
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

function asAdrDraftArray(v: unknown): NewAdrDraft[] {
  if (!Array.isArray(v)) return [];
  const out: NewAdrDraft[] = [];
  for (const item of v) {
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o['title'] !== 'string') continue;
    const status = o['status'] === 'Proposed' ? 'Proposed' : 'Accepted';
    const draft: NewAdrDraft = {
      title: o['title'],
      status,
      context: typeof o['context'] === 'string' ? o['context'] : '',
      decision: typeof o['decision'] === 'string' ? o['decision'] : '',
      consequences: typeof o['consequences'] === 'string' ? o['consequences'] : ''
    };
    if (Array.isArray(o['supersedes'])) {
      draft.supersedes = asStringArray(o['supersedes']);
    }
    if (Array.isArray(o['affectedComponents'])) {
      draft.affectedComponents = asStringArray(o['affectedComponents']);
    }
    const rev = o['reversibility'];
    if (rev === 'Reversible' || rev === 'One-way' || rev === 'Irreversible') {
      draft.reversibility = rev;
    }
    const dm = o['decisionMakers'];
    if (dm === 'Operator' || dm === 'EA Architect Agent' || dm === 'Both') {
      draft.decisionMakers = dm;
    }
    out.push(draft);
  }
  return out;
}

function asAffectedAdrArray(v: unknown): AffectedAdr[] {
  if (!Array.isArray(v)) return [];
  const out: AffectedAdr[] = [];
  for (const item of v) {
    if (item === null || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (typeof o['adrId'] !== 'string') continue;
    const action = o['action'] === 'supersede' ? 'supersede' : 'amend';
    out.push({
      adrId: o['adrId'],
      action,
      ...(typeof o['reason'] === 'string' ? { reason: o['reason'] } : {})
    });
  }
  return out;
}

function emptyOutput(status: ReviewStatus, diagnostic: string): CriticOutput {
  return {
    status,
    reasoning: diagnostic,
    cited_adrs: [],
    cited_principles: [],
    cited_lessons: [],
    requested_modifications: [],
    new_adrs_to_file: [],
    affected_existing_adrs: [],
    ok: false,
    diagnostic
  };
}

/**
 * Hallucination guard — drop cited ids that don't exist in the loaded
 * repository. Returns a copy of the output with any unverifiable
 * citations removed.
 */
export function applyHallucinationGuard(
  output: CriticOutput,
  context: RelevantContext,
  allKnownAdrIds: ReadonlySet<string>,
  allKnownPrincipleIds: ReadonlySet<string>,
  allKnownLessonIds: ReadonlySet<string>
): CriticOutput {
  const _contextUnused = context; // reserved for future relevance-window narrowing
  void _contextUnused;
  const cited_adrs = output.cited_adrs.filter((id) => allKnownAdrIds.has(id));
  const cited_principles = output.cited_principles.filter((id) => allKnownPrincipleIds.has(id));
  const cited_lessons = output.cited_lessons.filter((id) => allKnownLessonIds.has(id));
  const affected_existing_adrs = output.affected_existing_adrs.filter((a) =>
    allKnownAdrIds.has(a.adrId)
  );
  // Drop new_adrs_to_file entries whose supersedes target a non-existent ADR.
  const new_adrs_to_file = output.new_adrs_to_file.map((draft) => {
    if (draft.supersedes === undefined) return draft;
    const supersedes = draft.supersedes.filter((id) => allKnownAdrIds.has(id));
    if (supersedes.length === 0) {
      const { supersedes: _omit, ...rest } = draft;
      void _omit;
      return rest;
    }
    return { ...draft, supersedes };
  });
  return {
    ...output,
    cited_adrs,
    cited_principles,
    cited_lessons,
    affected_existing_adrs,
    new_adrs_to_file
  };
}
