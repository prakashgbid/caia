/**
 * AI/ML's contributions to the EA Reviewer's cross-architect invariants
 * registry (per spec §6.2).
 *
 * Each invariant is a pure predicate over either the per-architect
 * `architectureFields` dict (flat keys like `'aiml.modelSelection'`) or
 * the composed `tickets.architecture` JSONB blob (nested under `aiml.*`).
 *
 * Both views are accepted — `readField()` checks the flat key first,
 * then falls back to walking the nested path.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 */

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  /** Architect that contributed this invariant. */
  contributor: string;
  /** Other architects whose fields this invariant reads. */
  reads: readonly string[];
  /** Severity if the predicate returns false. */
  severity: InvariantSeverity;
  /** Operator-facing description for the Reviewer's audit log. */
  description: string;
  /**
   * The predicate. Receives the JSONB blob (flat-keyed
   * `architectureFields` view OR nested composed-architecture view).
   * Pure + synchronous.
   */
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

/**
 * Read a field from the architecture blob. Tries the flat dotted key
 * first (matches `architectureFields` shape), then falls back to walking
 * the nested object path (matches composed-architecture shape).
 */
function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

const REQUIRED_SAFETY_CHECKS = [
  'piiDetection',
  'promptInjectionGuard',
  'outputContentFilter',
  'hallucinationGate',
  'refusalAuditLog'
] as const;

const VALID_MODELS = new Set([
  'haiku',
  'sonnet',
  'opus',
  'claude-haiku-4-5',
  'claude-sonnet-4-6',
  'claude-opus-4-6'
]);

const MIN_EVAL_CASES = 5;

/**
 * AI/ML's contributed invariants. Listed in stable order.
 */
export const AIML_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'aiml.modelSelection-nonempty',
    contributor: 'ai-ml',
    reads: ['aiml.modelSelection'],
    severity: 'fail',
    description:
      'Every AI/ML output must declare at least one call type with a model selection. An empty modelSelection means the architect failed to identify any AI/ML call.',
    detect(arch): boolean {
      const ms = readField(arch, 'aiml.modelSelection');
      if (typeof ms !== 'object' || ms === null) return false;
      return Object.keys(ms as Record<string, unknown>).length > 0;
    }
  },
  {
    id: 'aiml.modelSelection-anthropic-only',
    contributor: 'ai-ml',
    reads: ['aiml.modelSelection'],
    severity: 'fail',
    description:
      'The locked stack mandates Anthropic Claude only. Any model decision other than haiku/sonnet/opus (or the full claude-* tags) is a hard violation.',
    detect(arch): boolean {
      const ms = readField(arch, 'aiml.modelSelection');
      if (typeof ms !== 'object' || ms === null) return false;
      for (const [, entry] of Object.entries(ms as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) return false;
        const model = (entry as Record<string, unknown>).model;
        if (typeof model !== 'string' || !VALID_MODELS.has(model)) return false;
      }
      return true;
    }
  },
  {
    id: 'aiml.safetyChecks-all-five-present',
    contributor: 'ai-ml',
    reads: ['aiml.aiSafetyChecks'],
    severity: 'fail',
    description:
      'All five safety checks (piiDetection, promptInjectionGuard, outputContentFilter, hallucinationGate, refusalAuditLog) must be present. Posture may vary; the gate itself cannot be omitted.',
    detect(arch): boolean {
      const sc = readField(arch, 'aiml.aiSafetyChecks');
      if (typeof sc !== 'object' || sc === null) return false;
      const got = new Set(Object.keys(sc as Record<string, unknown>));
      for (const required of REQUIRED_SAFETY_CHECKS) {
        if (!got.has(required)) return false;
      }
      return true;
    }
  },
  {
    id: 'aiml.evalSuite-min-five-cases',
    contributor: 'ai-ml',
    reads: ['aiml.evalSuite'],
    severity: 'advisory',
    description:
      'Every call type in evalSuite should have at least 5 eval cases. Fewer than 5 cases means insufficient coverage for the quality gate.',
    detect(arch): boolean {
      const suite = readField(arch, 'aiml.evalSuite');
      if (typeof suite !== 'object' || suite === null) return true; // trivially pass when no suite
      for (const [, entry] of Object.entries(suite as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) return false;
        const cases = (entry as Record<string, unknown>).evalCases;
        if (!Array.isArray(cases) || cases.length < MIN_EVAL_CASES) return false;
      }
      return true;
    }
  },
  {
    id: 'aiml.callType-set-consistent',
    contributor: 'ai-ml',
    reads: [
      'aiml.modelSelection',
      'aiml.promptPatterns',
      'aiml.evalSuite',
      'aiml.costAttribution',
      'aiml.temperaturePresets',
      'aiml.outputSchemas',
      'aiml.cacheStrategy'
    ],
    severity: 'fail',
    description:
      'Every call type declared in modelSelection must have matching entries in promptPatterns, evalSuite, costAttribution, temperaturePresets, outputSchemas, and cacheStrategy. Missing per-call-type fields cascade into runtime failures.',
    detect(arch): boolean {
      const ms = readField(arch, 'aiml.modelSelection');
      if (typeof ms !== 'object' || ms === null) return false;
      const callTypes = Object.keys(ms as Record<string, unknown>);
      const perCallTypeFields = [
        'aiml.promptPatterns',
        'aiml.evalSuite',
        'aiml.costAttribution',
        'aiml.temperaturePresets',
        'aiml.outputSchemas',
        'aiml.cacheStrategy'
      ];
      for (const fieldPath of perCallTypeFields) {
        const value = readField(arch, fieldPath);
        if (typeof value !== 'object' || value === null) return false;
        const keys = new Set(Object.keys(value as Record<string, unknown>));
        for (const ct of callTypes) {
          if (!keys.has(ct)) return false;
        }
      }
      return true;
    }
  },
  {
    id: 'aiml.deterministic-calls-must-cache',
    contributor: 'ai-ml',
    reads: ['aiml.temperaturePresets', 'aiml.cacheStrategy'],
    severity: 'advisory',
    description:
      'Calls with temperature 0.0 are deterministic and should always have an exact-cache TTL set. Otherwise the deterministic guarantee is wasted spend.',
    detect(arch): boolean {
      const temps = readField(arch, 'aiml.temperaturePresets');
      const caches = readField(arch, 'aiml.cacheStrategy');
      if (typeof temps !== 'object' || temps === null) return true;
      if (typeof caches !== 'object' || caches === null) return false;
      const cacheMap = caches as Record<string, unknown>;
      for (const [callType, preset] of Object.entries(temps as Record<string, unknown>)) {
        if (typeof preset !== 'object' || preset === null) continue;
        const t = (preset as Record<string, unknown>).temperature;
        if (typeof t === 'number' && t === 0) {
          const cacheEntry = cacheMap[callType];
          if (typeof cacheEntry !== 'object' || cacheEntry === null) return false;
          const exact = (cacheEntry as Record<string, unknown>).exact;
          if (exact === null || exact === undefined) return false;
        }
      }
      return true;
    }
  }
];
