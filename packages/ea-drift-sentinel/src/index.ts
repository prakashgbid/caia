/**
 * @caia/ea-drift-sentinel — public surface.
 *
 * Watches the event bus, detects principle violations via tier-1 +
 * tier-2 checks, persists drift entries to JSONL, escalates to INBOX
 * when severity warrants.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §4.6.
 */

export { EaDriftSentinel, type SentinelEventResult } from './sentinel.js';
export { DEFAULT_PRINCIPLE_RULES } from './principle-rules.js';
export { Tier1Detector } from './tier1-detector.js';
export { HeuristicTier2Adapter, StubTier2Adapter } from './tier2-detector.js';
export { DriftLog } from './drift-log.js';
export type {
  BusEvent,
  Tier1Rule,
  Tier1Hit,
  Tier2Confirmation,
  Tier2Adapter,
  DriftLogEntry,
  DriftSentinelConfig
} from './types.js';
