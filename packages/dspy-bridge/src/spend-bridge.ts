/**
 * Local re-export of @chiefaia/spend-guard's SpendRecord shape so this
 * package doesn't take a hard dependency on it just for a type.
 *
 * The trace pipeline (`trainset.ts`) reads spend records as a *gating
 * signal*, not as the source of input/output. The Langfuse migration
 * (proposal §7) swaps both surfaces for a single trace stream, so we
 * keep the type local — when the migration lands, this file's only job
 * is to import from `@chiefaia/langfuse-export` instead.
 */

export interface SpendRecord {
  id: string;
  taskId: string;
  projectId: string | null;
  agentRole: string;
  model: string;
  via: 'subscription' | 'api-key' | 'ollama';
  accountId: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  tsMsEpoch: number;
}
