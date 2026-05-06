/**
 * Routing taxonomy for the operator-chat panel.
 *
 * Mirrors the deterministic local-provider in `@chiefaia/prompt-evals`'s
 * `evals/_lib/local-provider.mjs`. Inlined here so the dashboard route
 * has zero runtime dep on the workspace package.
 *
 * Wave 1.3 of the Enterprise Wave 1 campaign per
 * `agent/memory/enterprise_ai_landscape_directive.md` (W1-2-add).
 */

export interface RouteDecision {
  agent: string;
  classification: string;
  matchedRule: string | null;
}

const ROUTING_KEYWORDS: Record<string, ReadonlyArray<{ rx: RegExp; classification: string }>> = {
  'caia-po': [
    { rx: /decompose|story|epic|initiative/i, classification: 'decomposition' },
    { rx: /classify|domain|taxonomy/i, classification: 'classification' }
  ],
  'caia-ba': [
    { rx: /acceptance criteria|enrich|ticket template/i, classification: 'enrichment' },
    { rx: /consultant|architect|database/i, classification: 'consultation' }
  ],
  'caia-ea': [
    { rx: /architecture|design|build-vs-buy/i, classification: 'architecture' }
  ],
  'caia-validator': [
    { rx: /done|dod|definition of done/i, classification: 'dod-check' },
    { rx: /premature|skipped|--no-verify|gh pr close/i, classification: 'red-flag' }
  ],
  'caia-test-design': [
    { rx: /test plan|unit test|integration|e2e|adversarial/i, classification: 'plan-design' }
  ],
  'caia-coding': [
    { rx: /implement|write code|patch|feature branch/i, classification: 'implementation' },
    { rx: /\bpr\b|merge|push|gh pr create/i, classification: 'pr-flow' }
  ],
  'caia-fix-it': [
    { rx: /failing|red|broken|ci failed/i, classification: 'failure-diagnosis' },
    { rx: /flake|timing|retry/i, classification: 'flake-handling' }
  ],
  'caia-steward': [
    { rx: /gatekeeper|failure mode|block|warn|pass/i, classification: 'gatekeeper-verdict' }
  ],
  'caia-mentor': [
    { rx: /lesson|incident|root cause|classification/i, classification: 'lesson-capture' }
  ],
  'caia-curator': [
    {
      rx: /scan|finding|alarm|pr proposal|backlog directive|industry briefing/i,
      classification: 'action-routing'
    }
  ]
};

// Order matters: more specific agents come first so general rules (e.g.,
// PO's `story` regex) don't snipe a more-specific match (e.g., BA's `enrich`).
const AGENT_ORDER = [
  'caia-validator',
  'caia-fix-it',
  'caia-steward',
  'caia-mentor',
  'caia-curator',
  'caia-test-design',
  'caia-ea',
  'caia-ba',
  'caia-coding',
  'caia-po'
];

export function routeMessage(content: string): RouteDecision {
  for (const agent of AGENT_ORDER) {
    const rules = ROUTING_KEYWORDS[agent];
    if (!rules) continue;
    for (const rule of rules) {
      if (rule.rx.test(content)) {
        return { agent, classification: rule.classification, matchedRule: rule.rx.source };
      }
    }
  }
  return { agent: 'caia-po', classification: 'unrouted', matchedRule: null };
}

export interface OrchestratorForwardResult {
  promptId: string | null;
  forwarded: boolean;
}

/**
 * Forward the prompt to the orchestrator if configured. Fire-and-forget;
 * never throws.
 */
export async function maybeForwardToOrchestrator(content: string): Promise<OrchestratorForwardResult> {
  const url = process.env['CAIA_ORCHESTRATOR_URL'];
  if (!url) return { promptId: null, forwarded: false };
  try {
    const res = await fetch(`${url}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: content, receivedVia: 'chat' })
    });
    if (!res.ok) return { promptId: null, forwarded: false };
    const data = (await res.json()) as { id?: string };
    return { promptId: data.id ?? null, forwarded: true };
  } catch {
    return { promptId: null, forwarded: false };
  }
}

export function buildAssistantText(
  decision: RouteDecision,
  promptIdInfo: OrchestratorForwardResult
): string[] {
  const lines: string[] = [];
  lines.push(`Routed to **${decision.agent}** (classification: \`${decision.classification}\`).`);
  if (decision.matchedRule) {
    lines.push(`Matched routing rule: \`${decision.matchedRule}\`.`);
  } else {
    lines.push('No routing rule matched — defaulted to caia-po.');
  }
  lines.push('');
  if (promptIdInfo.forwarded && promptIdInfo.promptId) {
    lines.push(`Forwarded to orchestrator as prompt \`${promptIdInfo.promptId}\`.`);
    lines.push(`See it land at \`/prompts/${promptIdInfo.promptId}\`.`);
  } else if (promptIdInfo.forwarded) {
    lines.push('Forwarded to orchestrator but no prompt ID returned.');
  } else {
    lines.push('Orchestrator not configured (set `CAIA_ORCHESTRATOR_URL` to forward prompts live).');
  }
  return lines;
}

/**
 * Encode a string as a Vercel AI SDK Data Stream Protocol "text" chunk.
 * @see https://sdk.vercel.ai/docs/ai-sdk-ui/stream-protocol#data-stream-protocol
 */
export function encodeTextChunk(text: string): string {
  return `0:${JSON.stringify(text)}\n`;
}

/**
 * Encode the AI SDK's "finish_message" frame so the client's useChat
 * hook closes the message cleanly.
 */
export function encodeFinishMessage(promptTokens: number, completionTokens: number): string {
  const payload = {
    finishReason: 'stop',
    usage: { promptTokens, completionTokens }
  };
  return `d:${JSON.stringify(payload)}\n`;
}
