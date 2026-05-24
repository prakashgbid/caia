/**
 * Operator-escalation surfacing.
 *
 * When the EA Architect Agent encounters a genuinely-strategic decision
 * (product pivot, billing-model change, fundamental architecture
 * reversal, security posture change, principle amendment) it escalates
 * to the operator by appending an entry under a dedicated section in
 * the operator's INBOX.md.
 *
 * Routine technical approval is NEVER escalated — that is the whole
 * point of this agent.
 */

import type { FsAdapter, OperatorEscalation, PlanType } from './types.js';

/** The section header where EA Agent escalations land in INBOX.md. */
export const ESCALATION_SECTION_HEADER = '## EA AGENT ESCALATIONS';

export interface EscalationAppendInput {
  submissionId: string;
  callerAgentId: string;
  planType: PlanType;
  escalation: OperatorEscalation;
  at: Date;
}

/** Render the markdown for a single escalation entry. */
export function renderEscalationEntry(input: EscalationAppendInput): string {
  const date = input.at.toISOString();
  const cat = input.escalation.category ?? 'unspecified';
  const rec = input.escalation.recommendation
    ? `\n  - **Recommendation:** ${input.escalation.recommendation}`
    : '';
  return `- [ ] ${date} | submission \`${input.submissionId}\` (from \`${input.callerAgentId}\`, planType=${input.planType}, category=${cat}) [ea-agent-escalation]
  - **Decision point:** ${input.escalation.decisionPoint}
  - **Reason:** ${input.escalation.reason}${rec}\n`;
}

/**
 * Append the escalation entry under the dedicated section in INBOX.md.
 * Creates the section if it doesn't yet exist. Returns the path written.
 */
export function appendEscalationToInbox(
  fs: FsAdapter,
  inboxPath: string,
  input: EscalationAppendInput
): string {
  const entry = renderEscalationEntry(input);
  if (!fs.exists(inboxPath)) {
    const content = `# INBOX — Future To-Do Items\n\n${ESCALATION_SECTION_HEADER}\n\n${entry}`;
    fs.writeFile(inboxPath, content);
    return entry;
  }
  const body = fs.readFile(inboxPath);
  if (body.includes(ESCALATION_SECTION_HEADER)) {
    // Insert at the end of the section, before the next top-level heading.
    const startIdx = body.indexOf(ESCALATION_SECTION_HEADER);
    const afterHeader = startIdx + ESCALATION_SECTION_HEADER.length;
    // Find next top-level "## " heading (or end of file)
    let endIdx = body.length;
    const searchFrom = afterHeader;
    const tail = body.slice(searchFrom);
    const nextHeading = tail.search(/\n##\s+/);
    if (nextHeading >= 0) endIdx = searchFrom + nextHeading;
    const newBody =
      body.slice(0, endIdx).replace(/\s*$/, '') + `\n\n${entry}\n` + body.slice(endIdx);
    fs.writeFile(inboxPath, newBody);
  } else {
    // Append the section at the end of the file.
    const newBody = `${body.trimEnd()}\n\n${ESCALATION_SECTION_HEADER}\n\n${entry}`;
    fs.writeFile(inboxPath, newBody);
  }
  return entry;
}

/**
 * Heuristic: even if the LLM did not flag the plan for escalation, check
 * for hard-rule triggers in the plan text + plan type that the agent
 * MUST escalate on. This guards against the LLM under-escalating on a
 * strategic decision.
 */
const STRATEGIC_TRIGGERS: { keyword: RegExp; category: OperatorEscalation['category']; reason: string }[] = [
  // Product pivots
  { keyword: /\bproduct\s+pivot\b/i, category: 'product-pivot', reason: 'plan text mentions product pivot' },
  // Billing-model
  {
    keyword: /\b(billing|pricing)\s+(model|change|update)\b/i,
    category: 'billing-model-change',
    reason: 'plan text mentions billing/pricing model change'
  },
  // Fundamental architecture reversal
  {
    keyword: /\b(reverse|reversal|undo|abandon)\s+(architecture|the\s+architecture|adr)\b/i,
    category: 'fundamental-architecture-reversal',
    reason: 'plan text mentions reversing a fundamental architecture decision'
  },
  // Security posture
  {
    keyword: /\bsecurity\s+(posture|model|stance)\b/i,
    category: 'security-posture-change',
    reason: 'plan text mentions security posture change'
  },
  // Principle amendment
  {
    keyword: /\b(amend|deprecate|supersede)\s+(principle\s+p?\d+|principles?)\b/i,
    category: 'principle-amendment',
    reason: 'plan text mentions amending a principle'
  }
];

/** Inspect a plan and return an escalation candidate if any trigger fires. */
export function detectStrategicEscalation(
  planMarkdown: string
): OperatorEscalation | null {
  for (const trig of STRATEGIC_TRIGGERS) {
    if (trig.keyword.test(planMarkdown)) {
      return {
        reason: trig.reason,
        decisionPoint: 'review for operator sign-off',
        ...(trig.category !== undefined ? { category: trig.category } : {})
      };
    }
  }
  return null;
}
