/**
 * Tier-1 deterministic detector. Iterates the ruleset against an event;
 * returns hits.
 */

import type { BusEvent, Tier1Hit, Tier1Rule } from './types.js';

export class Tier1Detector {
  constructor(private readonly rules: Tier1Rule[]) {}

  detect(event: BusEvent, nowIso: string): Tier1Hit[] {
    const hits: Tier1Hit[] = [];
    for (const rule of this.rules) {
      const matchType =
        typeof rule.eventTypePattern === 'string'
          ? event.type === rule.eventTypePattern
          : rule.eventTypePattern.test(event.type);
      if (!matchType) continue;
      if (!rule.predicate(event)) continue;
      hits.push({
        ruleId: rule.id,
        principleId: rule.principleId,
        event,
        reason: rule.reason,
        severity: rule.severity,
        detectedAtIso: nowIso
      });
    }
    return hits;
  }
}
