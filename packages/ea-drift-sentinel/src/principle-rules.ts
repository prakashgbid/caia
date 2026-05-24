/**
 * Encoded tier-1 ruleset derived from CAIA's 12 principles.
 *
 * Each rule is intentionally specific — its predicate matches a single
 * obvious violation pattern. The two-tier design means false positives
 * here are tolerable (tier 2 confirms), so we err toward sensitivity.
 *
 * Rules cover the principle subset where deterministic detection is
 * possible. Principles that require LLM reasoning (e.g. P11 event-first
 * across multiple events) are handled by tier 2 alone.
 */

import type { Tier1Rule } from './types.js';

function getNumber(payload: Record<string, unknown>, key: string): number | undefined {
  const v = payload[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && !Number.isNaN(parseFloat(v))) return parseFloat(v);
  return undefined;
}

export const DEFAULT_PRINCIPLE_RULES: Tier1Rule[] = [
  {
    id: 'P2-cost-incurred',
    principleId: 'P2',
    eventTypePattern: /^(deploy|infra|build|spend)\./,
    predicate: (e): boolean => {
      const cost = getNumber(e.payload, 'cost') ?? getNumber(e.payload, 'cost_usd');
      return cost !== undefined && cost > 0;
    },
    reason: 'cost > $0 incurred; P2 (zero-dollar budget during build) violated',
    severity: 'block'
  },
  {
    id: 'P14-api-key-detected',
    principleId: 'P14',
    eventTypePattern: /.*/,
    predicate: (e): boolean => {
      const payloadStr = JSON.stringify(e.payload);
      return /(?:sk-[A-Za-z0-9]|"api[_-]?key"|"anthropic[_-]?key")/i.test(payloadStr);
    },
    reason: 'API-key reference detected; P14 (subscription-only LLM, no API keys) violated',
    severity: 'block'
  },
  {
    id: 'P11-event-first-missing-id',
    principleId: 'P11',
    eventTypePattern: /\.(approved|rejected|completed|failed)$/,
    predicate: (e): boolean => {
      const id =
        typeof e.payload['submissionId'] === 'string' ||
        typeof e.payload['ticketId'] === 'string' ||
        typeof e.payload['traceId'] === 'string';
      return !id;
    },
    reason: 'terminal event missing correlation id (submissionId|ticketId|traceId); P11 (event-first) violated',
    severity: 'warn'
  },
  {
    id: 'P9-no-mock-data-in-prod',
    principleId: 'P9',
    eventTypePattern: /^(deploy|prod|release)\./,
    predicate: (e): boolean => {
      const s = JSON.stringify(e.payload).toLowerCase();
      return /\bmock|stub|fake\b/.test(s);
    },
    reason: 'mock/stub/fake reference in prod-flagged event; P9 (no mock data in prod) violated',
    severity: 'warn'
  },
  {
    id: 'P1-no-paid-llm',
    principleId: 'P1',
    eventTypePattern: /^(llm|claude|gpt)\./,
    predicate: (e): boolean => {
      const billing = typeof e.payload['billing'] === 'string' ? e.payload['billing'] : '';
      const tier = typeof e.payload['tier'] === 'string' ? e.payload['tier'] : '';
      return billing === 'api' || tier === 'api' || typeof e.payload['cost_usd'] === 'number';
    },
    reason: 'LLM call billed via API tier; P1 (subscription-only build) violated',
    severity: 'block'
  }
];
