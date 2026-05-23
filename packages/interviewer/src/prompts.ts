/**
 * @caia/interviewer — LLM prompt templates.
 *
 * One file holding every prompt the engine sends so reviewers can read
 * them in one place, and so prompt tuning is a single-file PR rather
 * than a scavenger hunt. All prompts demand strict JSON output (no
 * prose, no markdown fences) and pin the expected shape inline so the
 * extractor in `llm.ts` can recover even when the model regresses.
 */
export function initExtractionPrompt(grandIdea) {
    return `You are a senior startup consultant initializing an interview. Read the founder's grand-idea prompt below. Extract a minimal 4-field skeleton.

Output STRICT JSON, no prose, no markdown fences:
{
  "audience":          "1-2 sentences — who this is for, in the customer's own words if you can infer them",
  "problem":           "1-2 sentences — concrete pain you can hear the customer voicing",
  "solution":          "1-2 sentences — what ships, mechanism-level (not 'AI-powered' — the actual mechanism)",
  "hypothesizedValue": "1 sentence — why a busy customer pays to escape this"
}

Mark unknown fields as the literal string "unknown" — do NOT invent.

GRAND IDEA:
"""
${grandIdea.trim()}
"""

JSON:`;
}
export function ingestExtractionPrompt(picked, userReply) {
    const qList = picked
        .map((p, i) => `  ${i + 1}. id=${p.question.id}   pillar=${p.question.pillar}   Q: ${p.question.question}`)
        .join('\n');
    return `You are a senior startup consultant ingesting a founder's reply. The founder was asked these questions:

${qList}

The founder's reply:
"""
${userReply.trim()}
"""

Extract, per question, a 1-3 sentence answer summary capturing the decisioned content, plus a confidence score 0-100 (100 = founder gave a sharp, sourced, non-fuzzy answer; 50 = directional but unspecific; ≤ 20 = ambiguous or evasive).

Output STRICT JSON, no prose, no markdown fences:
{
  "extractions": [
    {
      "questionId": "<one of the question ids above>",
      "answerSummary": "<1-3 sentence summary in the founder's own words where possible>",
      "confidence": <0-100 integer>,
      "structured": { ... optional pillar-specific structured fields ... },
      "citations": [ { "url": "...", "title": "..." } ]
    }
  ],
  "unanswered": ["<question id>", "..."],
  "contradictions": ["<turn N contradicts turn M because ...>"]
}

JSON:`;
}
export function rubricEvaluationPrompt(plan) {
    const planJson = JSON.stringify(plan, null, 2);
    return `You are evaluating a startup business plan against an investor-grade rubric. Score each dimension on a 1-5 integer scale (1 = fail, 3 = ok, 5 = excellent). Do NOT score "specificity" — that is computed deterministically elsewhere.

Dimensions (with anchors):
  - internalConsistency: 1 contradicts ↔ 5 fully coheres
  - decisionDensity:     1 aspirational ↔ 5 nearly every paragraph is a decision
  - buildability:        1 dev still has 20 questions ↔ 5 dev can start designing today
  - scopeFiniteness:     1 boundless ↔ 5 sharp in/out list with named exclusions
  - audienceFocus:       1 all-of-humanity ↔ 5 named persona + named non-audience
  - riskAwareness:       1 no risks named ↔ 5 risks + mitigations decisioned
  - marketEvidence:      1 hand-wave ↔ 5 numbers + cites + both top-down/bottom-up
  - horizonDiscipline:   1 MVP=everything ↔ 5 sharp MVP fence, 1yr gated/unconditional, 5yr conceptual
  - investability:       1 VC asks 30 questions ↔ 5 VC invests a meeting

Output STRICT JSON, no prose, no markdown fences:
{
  "dimensions": {
    "internalConsistency": <1-5>,
    "decisionDensity":     <1-5>,
    "buildability":        <1-5>,
    "scopeFiniteness":     <1-5>,
    "audienceFocus":       <1-5>,
    "riskAwareness":       <1-5>,
    "marketEvidence":      <1-5>,
    "horizonDiscipline":   <1-5>,
    "investability":       <1-5>
  },
  "weakestSections": ["<section key>", "..."],
  "oneLineRationale": "<single sentence summarising why aggregate is what it is>"
}

PLAN:
${planJson}

JSON:`;
}
export function selfCritiquePrompt(plan, passNumber) {
    const planJson = JSON.stringify(plan, null, 2);
    const passContext = passNumber === 1
        ? 'This is the first self-critique pass. Be a skeptical PM, not a perfectionist.'
        : 'This is the SECOND and FINAL self-critique pass — the operator asked you to look again. Reserve "ask one more question" for genuine ship-blockers. Anything you call out here will be re-asked.';
    return `You are a skeptical Product Manager reviewing this business plan before it ships to design and engineering. ${passContext}

List the 5 things most likely to blow up when this reaches design or first 30 customers. For each: would you ship it as-is, or ask one more question? If ask, what question?

Output STRICT JSON, no prose, no markdown fences:
{
  "blowupItems": [
    {
      "item":                       "<concrete thing, 1 sentence>",
      "rationale":                  "<why this blows up, 1 sentence>",
      "shipAsIs":                   true | false,
      "suggestedFollowupQuestion":  "<optional, only if shipAsIs=false>",
      "pillar":                     "<optional B1..B16>"
    },
    ... 4 more ...
  ],
  "recommendation": "ship_as_is" | "roll_back"
}

Rules:
  - Set recommendation to "roll_back" if ≥ 2 items have shipAsIs=false with substantive rationale.
  - Otherwise "ship_as_is".

PLAN:
${planJson}

JSON:`;
}
// ─────────────────────────────────────────────────────────────────────────
// CRITIC PASS — Series Seed VC subagent (see critic.ts)
// ─────────────────────────────────────────────────────────────────────────
export function criticPassSystemPrompt() {
    return `You are a partner at a top-25 seed-stage VC fund. You are reading this business plan cold — no warm intro. In 5 minutes you will decide one of three things: invite the founder to a meeting, pass with a kind note, or pass with no note. Identify the 5 specific factors that most influence your decision, the questions you would ask in the meeting if you took it, and your final recommendation. Be specific. Quote the plan. Do not be polite. Do not flatter. You read 200 of these a quarter.`;
}
export function criticPassUserPrompt(plan) {
    const planJson = JSON.stringify(plan, null, 2);
    return `Output STRICT JSON, no prose, no markdown fences:
{
  "recommendation": "meeting" | "pass_kind" | "pass_no_note",
  "top5DecisionFactors": [
    { "factor": "...", "quote": "...", "sentiment": "positive" | "negative" }
  ],
  "meetingQuestions": ["..."],
  "blockers": [
    { "issue": "...", "planSection": "...", "severity": "blocker" | "major" | "minor" }
  ]
}

Output exactly 5 factors and 0-7 meeting questions. Blockers should only be listed if they would actually keep you from taking a meeting — be honest.

PLAN:
${planJson}

JSON:`;
}
//# sourceMappingURL=prompts.js.map