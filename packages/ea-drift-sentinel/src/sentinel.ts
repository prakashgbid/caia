/**
 * EaDriftSentinel — composes tier 1 + tier 2 + drift log + INBOX escalation.
 *
 * Wires to the event bus as a wildcard subscriber. The bus interface is
 * intentionally loose: any object with `on(type, handler)` works. In
 * production this is the @caia/ea-architect InProcessEventBus (or, later,
 * the NATS-backed bus once that ships).
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  appendEscalationToInbox,
  defaultFsAdapter,
  type FsAdapter,
  type PrincipleRecord
} from '@caia/ea-architect';

import { DriftLog } from './drift-log.js';
import { DEFAULT_PRINCIPLE_RULES } from './principle-rules.js';
import { HeuristicTier2Adapter } from './tier2-detector.js';
import { Tier1Detector } from './tier1-detector.js';
import type {
  BusEvent,
  DriftLogEntry,
  DriftSentinelConfig,
  Tier1Hit,
  Tier2Adapter
} from './types.js';

const DEFAULT_DRIFT_DIR = join(homedir(), 'Documents', 'projects', 'caia-ea', 'drift-log');
const DEFAULT_INBOX_PATH = join(homedir(), 'Documents', 'projects', 'agent-memory', 'INBOX.md');

/** Result of processing one event. */
export interface SentinelEventResult {
  /** Tier-1 hits — may be empty. */
  hits: Tier1Hit[];
  /** Confirmed drift entries (passed tier-2). */
  confirmed: DriftLogEntry[];
  /** Were any escalated to INBOX? */
  escalated: number;
}

export class EaDriftSentinel {
  private readonly fs: FsAdapter;
  private readonly clock: () => Date;
  private readonly t1: Tier1Detector;
  private readonly t2: Tier2Adapter;
  private readonly log: DriftLog;
  private readonly principles: PrincipleRecord[];
  private readonly inboxPath: string;

  constructor(cfg: DriftSentinelConfig = {}) {
    this.fs = cfg.fs ?? defaultFsAdapter;
    this.clock = cfg.clock ?? ((): Date => new Date());
    this.t1 = new Tier1Detector(cfg.rules ?? DEFAULT_PRINCIPLE_RULES);
    this.t2 = cfg.tier2 ?? new HeuristicTier2Adapter();
    this.log = new DriftLog(cfg.driftLogDir ?? DEFAULT_DRIFT_DIR, this.fs);
    this.principles = cfg.principles ?? [];
    this.inboxPath = DEFAULT_INBOX_PATH;
  }

  /** Process a single event through both tiers. */
  async process(event: BusEvent): Promise<SentinelEventResult> {
    const now = this.clock();
    const hits = this.t1.detect(event, now.toISOString());
    const confirmed: DriftLogEntry[] = [];
    let escalated = 0;
    for (const hit of hits) {
      const confirmation = await this.t2.confirm(hit, this.principles);
      if (!confirmation.confirmed) continue;
      const entry: DriftLogEntry = { hit, confirmation, escalatedToInbox: confirmation.escalate };
      this.log.append(entry, now);
      confirmed.push(entry);
      if (confirmation.escalate) {
        appendEscalationToInbox(this.fs, this.inboxPath, {
          submissionId: `drift-${hit.ruleId}-${now.getTime()}`,
          callerAgentId: '@caia/ea-drift-sentinel',
          planType: 'process-change',
          escalation: {
            reason: `Drift detected: ${hit.reason}`,
            decisionPoint: `Event ${hit.event.type} fired tier-1 rule ${hit.ruleId} (principle ${hit.principleId})`,
            recommendation: confirmation.reasoning,
            category: 'principle-amendment'
          },
          at: now
        });
        escalated += 1;
      }
    }
    return { hits, confirmed, escalated };
  }

  /** Compose a `architecture.principle.violated` event payload (caller emits it). */
  composeViolationEvent(entry: DriftLogEntry): { type: string; payload: Record<string, unknown>; at: string } {
    return {
      type: 'architecture.principle.violated',
      payload: {
        principleId: entry.hit.principleId,
        ruleId: entry.hit.ruleId,
        severity: entry.hit.severity,
        sourceEventType: entry.hit.event.type,
        reasoning: entry.confirmation.reasoning,
        escalated: entry.escalatedToInbox
      },
      at: this.clock().toISOString()
    };
  }
}
