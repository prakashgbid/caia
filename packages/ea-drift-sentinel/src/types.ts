/**
 * @caia/ea-drift-sentinel — public types.
 *
 * Reference: spec §4.6. Two-tier detector pattern:
 *   tier 1 = deterministic regex/structural checks on event payloads (cheap)
 *   tier 2 = LLM-reasoned checks invoked ONLY on tier-1 hits (bounded spend)
 */

import type { FsAdapter, PrincipleRecord } from '@caia/ea-architect';

/** Generic event the Sentinel watches. */
export interface BusEvent {
  /** Dotted event type, e.g. "deploy.cost-incurred". */
  type: string;
  /** Event payload — opaque to the Sentinel; principle rules pick fields. */
  payload: Record<string, unknown>;
  /** ISO timestamp the event was emitted. */
  at: string;
  /** Optional source agent id. */
  sourceAgentId?: string;
}

/** Tier-1 detection rule. */
export interface Tier1Rule {
  id: string; // e.g. "P2-cost-incurred"
  principleId: string; // e.g. "P2"
  /** Event type to match (exact or regex). */
  eventTypePattern: RegExp | string;
  /** Predicate on payload — returns true if the rule fires. */
  predicate: (event: BusEvent) => boolean;
  /** Human-readable reason if the rule fires. */
  reason: string;
  /** Severity. */
  severity: 'info' | 'warn' | 'block';
}

/** Tier-1 hit — passed to tier 2 for confirmation. */
export interface Tier1Hit {
  ruleId: string;
  principleId: string;
  event: BusEvent;
  reason: string;
  severity: 'info' | 'warn' | 'block';
  detectedAtIso: string;
}

/** Tier-2 confirmation — invoked on tier-1 hits. */
export interface Tier2Confirmation {
  confirmed: boolean;
  reasoning: string;
  /** True if the Sentinel recommends INBOX escalation. */
  escalate: boolean;
}

/** Tier-2 adapter — wraps LLM call. */
export interface Tier2Adapter {
  confirm(hit: Tier1Hit, principles: PrincipleRecord[]): Promise<Tier2Confirmation>;
}

/** A confirmed drift entry — persisted to drift-log/<date>.jsonl. */
export interface DriftLogEntry {
  hit: Tier1Hit;
  confirmation: Tier2Confirmation;
  escalatedToInbox: boolean;
}

export interface DriftSentinelConfig {
  fs?: FsAdapter;
  clock?: () => Date;
  driftLogDir?: string;
  /** Override rules. */
  rules?: Tier1Rule[];
  /** Tier-2 adapter — defaults to a heuristic (no-LLM) stub. */
  tier2?: Tier2Adapter;
  /** Loaded principles for tier-2 grounding. */
  principles?: PrincipleRecord[];
}
