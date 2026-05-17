/**
 * Helpers for emitting `agent_card.json` per A2A v1 spec.
 *
 * Per p4_agent_mesh_implementation_plan_2026_05_16.md §3 M0:
 *   "A2A wrapping of XiYanSQL: agent card at http://m3:8410/a2a/agent-card.json;
 *    JSON-RPC method `tasks/send`; SSE streaming on `tasks/sendSubscribe`."
 */

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  tags?: string[];
}

export interface AgentCard {
  schemaVersion: '1.0';
  agentId: string;
  name: string;
  description: string;
  /** The endpoint where `tasks/send` is hosted. */
  url: string;
  /** Optional SSE endpoint for `tasks/sendSubscribe`. */
  streamingUrl?: string;
  vendor?: { name: string; url?: string };
  /** Model behind the agent — surfaced for provenance gates. */
  provider: { kind: 'local' | 'cloud'; model: string; license: string };
  skills: AgentSkill[];
  /** Optional auth scheme; `none` for local-mesh trust boundary. */
  auth?: { kind: 'none' | 'bearer' | 'hmac'; header?: string };
}

export function buildAgentCard(card: AgentCard): AgentCard {
  // Validation hook — keep strict shape so consumers fail fast.
  if (card.schemaVersion !== '1.0') {
    throw new Error(`unsupported agent_card schemaVersion ${card.schemaVersion}`);
  }
  return card;
}
