/**
 * Deterministic local provider for promptfoo eval suites.
 *
 * Promptfoo expects a class-based custom provider — the default export
 * is a constructor; the instance must expose `id()` and `callApi(prompt, context, options)`
 * returning `{ output, ... }`. This provider does NOT call any LLM —
 * instead it inspects the prompt + the test's `vars` and produces a
 * deterministic structured output that the YAML assertions can score
 * against.
 *
 * Why: subscription-only LLM with no API-key billing means CI cannot
 * call out to the Anthropic API. Ollama in CI is impractical (gigabytes
 * to download per run). This provider gives us a regression gate that
 * runs in seconds + costs nothing, while still detecting prompt-shape
 * drift + assertion drift.
 *
 * Operators who want richer evals can swap in `ollama:llama3.2:3b` or
 * a custom `claude` shell-out provider locally — the YAML configs are
 * provider-agnostic.
 *
 * Output shape per test case:
 *   <multi-line text>
 *     agent: <slug>
 *     classification: <category>
 *     bypass-detected: <pattern>?    (only if matched)
 *     var.<key>: <value>             (per var)
 *     promptLength: <number>
 *     [result] DONE: synthesised by local-provider
 */

const ROUTING_KEYWORDS = {
  'caia-po': [
    { match: /decompose|story|epic|initiative/i, classification: 'decomposition' },
    { match: /classify|domain|taxonomy/i, classification: 'classification' }
  ],
  'caia-ba': [
    { match: /acceptance criteria|enrich|ticket template/i, classification: 'enrichment' },
    { match: /consultant|domain|architect|database/i, classification: 'consultation' }
  ],
  'caia-ea': [
    { match: /architecture|design|build-vs-buy/i, classification: 'architecture' },
    { match: /classify|domain|primary domain/i, classification: 'classification' }
  ],
  'caia-validator': [
    { match: /done|dod|definition of done/i, classification: 'dod-check' },
    { match: /premature|skipped|--no-verify|gh pr close/i, classification: 'red-flag' }
  ],
  'caia-test-design': [
    { match: /test plan|unit test|integration|e2e|adversarial/i, classification: 'plan-design' }
  ],
  'caia-coding': [
    { match: /implement|write code|patch|feature branch/i, classification: 'implementation' },
    { match: /pr|merge|push|gh pr create/i, classification: 'pr-flow' }
  ],
  'caia-fix-it': [
    { match: /failing|red|broken|ci failed/i, classification: 'failure-diagnosis' },
    { match: /flake|timing|retry/i, classification: 'flake-handling' }
  ],
  'caia-steward': [
    { match: /gatekeeper|failure mode|block|warn|pass/i, classification: 'gatekeeper-verdict' }
  ],
  'caia-mentor': [
    { match: /lesson|incident|root cause|classification/i, classification: 'lesson-capture' }
  ],
  'caia-curator': [
    { match: /scan|finding|alarm|pr proposal|backlog directive|industry briefing/i, classification: 'action-routing' }
  ]
};

const RESULT_DONE_RX = /\[result\]\s+DONE/i;
const RESULT_FAILED_RX = /\[result\]\s+FAILED/i;
const FORBIDDEN_BYPASS_PATTERNS = [
  /--no-verify\b/,
  /gh\s+pr\s+update-branch\b/,
  /gh\s+pr\s+close\b/,
  /it\.skip\(/
];

function classify(agent, prompt) {
  const rules = ROUTING_KEYWORDS[agent] ?? [];
  for (const rule of rules) {
    if (rule.match.test(prompt)) return rule.classification;
  }
  return 'unrouted';
}

function detectForbiddenBypass(prompt) {
  for (const rx of FORBIDDEN_BYPASS_PATTERNS) {
    if (rx.test(prompt)) return rx.source;
  }
  return null;
}

function buildSynthOutput(agent, prompt, vars) {
  const classification = classify(agent, prompt);
  const forbidden = detectForbiddenBypass(prompt);
  const lines = [];
  lines.push(`agent: ${agent}`);
  lines.push(`classification: ${classification}`);
  if (forbidden) lines.push(`bypass-detected: ${forbidden}`);
  if (vars && typeof vars === 'object') {
    for (const [k, v] of Object.entries(vars)) {
      lines.push(`var.${k}: ${String(v).slice(0, 200)}`);
    }
  }
  lines.push(`promptLength: ${prompt.length}`);
  lines.push('[result] DONE: synthesised by local-provider');
  return lines.join('\n');
}

/**
 * Class-shaped custom provider. Promptfoo instantiates with `new CustomApiProvider(options)`.
 */
class CaiaLocalProvider {
  constructor(options = {}) {
    this.providerId = options.id ?? 'caia-local-provider';
    this.config = options.config ?? {};
  }

  id() {
    return this.providerId;
  }

  async callApi(prompt, context) {
    const vars = (context && context.vars) || {};
    const agent = vars.agent ?? (context?.test?.metadata?.agent) ?? 'caia-unknown';
    const output = buildSynthOutput(agent, prompt, vars);
    return {
      output,
      tokenUsage: { total: 0, prompt: 0, completion: 0 },
      cost: 0,
      cached: false,
      metadata: {
        classification: classify(agent, prompt),
        promptLength: prompt.length,
        bypassDetected: detectForbiddenBypass(prompt) ?? null,
        hasResultDone: RESULT_DONE_RX.test(output),
        hasResultFailed: RESULT_FAILED_RX.test(output)
      }
    };
  }
}

export default CaiaLocalProvider;

// Test-friendly named exports — the unit-test suite imports these directly.
export { classify, detectForbiddenBypass, buildSynthOutput };
