/**
 * @chiefaia/agent-contract-registry — compose-template.ts (ACR-002)
 *
 * The composition algorithm. Builds a `ComposedTemplate` per `StoryScope`
 * by unioning all registered contracts whose `appliesTo` includes the
 * scope, applying scope overrides, resolving conflicts via agent-pipeline
 * order (PO < BA < EA < Test-Design), and computing a stable signature.
 *
 * The result is what the Story Validator consumes at runtime instead of
 * the hard-coded `validation-rubric.ts`.
 *
 * Token cost: zero. This is pure data manipulation — no LLM calls in this
 * layer. The downstream Validator runs the composed rubric's
 * `relevancePromptSeed`s identically to today.
 */

import {
  AGENT_ORDER,
  applyScopeOverride,
  type ComposedSectionEntry,
  type ComposedTemplate,
  type SectionContract,
  type StoryScope,
} from '@chiefaia/ticket-template';
import { getDefaultRegistry, type ContractRegistry } from './registry';
import { computeSignature } from './signature';

export interface ComposeOptions {
  /**
   * If true, throw on any composition warning (duplicate section, missing
   * dependency). CI uses this to fail builds on registry conflicts;
   * runtime uses the default (false) so warnings only log.
   */
  strict?: boolean;
  /** Override the default registry — useful for tests. */
  registry?: ContractRegistry;
}

/**
 * Compose a per-scope `ComposedTemplate` from the registry. Pure function
 * given a fixed registry state — the Validator caches results keyed on
 * the returned `signature`.
 *
 * Algorithm:
 *   1. Filter registry to contracts whose `appliesTo` includes `scope`.
 *   2. Sort contracts by agent-pipeline order (PO -> BA -> EA -> Test-Design).
 *      Tie-break by `contractId` for stable output.
 *   3. Iterate sections; first contract claiming a section name wins.
 *      Subsequent claims log a warning (or throw in strict mode).
 *   4. Apply per-section `scopeOverrides[scope]` to compute effective
 *      rubric + required.
 *   5. Verify each section's `dependencies` resolve within the composed
 *      template; warn for unresolved.
 *   6. Compute a stable `signature` over the composed entries.
 */
export function composeTemplate(
  scope: StoryScope,
  opts: ComposeOptions = {},
): ComposedTemplate {
  const registry = opts.registry ?? getDefaultRegistry();
  const allContracts = registry.list();
  const eligible = allContracts.filter((c) => c.appliesTo.includes(scope));

  // Stable ordering: agent pipeline order, then contractId asc for determinism.
  const ordered: SectionContract[] = [...eligible].sort((a, b) => {
    const ao = AGENT_ORDER[a.ownerAgent] - AGENT_ORDER[b.ownerAgent];
    if (ao !== 0) return ao;
    return a.contractId.localeCompare(b.contractId);
  });

  const sections = new Map<string, ComposedSectionEntry>();
  const warnings: string[] = [];

  for (const contract of ordered) {
    for (const baseSpec of contract.sections) {
      const existing = sections.get(baseSpec.name);
      if (existing) {
        const msg = `section '${baseSpec.name}' claimed by both ${existing.ownerAgent} (${existing.contractId}) and ${contract.ownerAgent} (${contract.contractId}); kept ${existing.contractId}`;
        if (opts.strict) {
          throw new Error(`[agent-contract-registry] ${msg}`);
        }
        warnings.push(msg);
        continue;
      }
      const { effectiveRubric, effectiveRequired } = applyScopeOverride(
        baseSpec,
        scope,
      );
      sections.set(baseSpec.name, {
        spec: baseSpec,
        effectiveRubric,
        effectiveRequired,
        ownerAgent: contract.ownerAgent,
        contractId: contract.contractId,
      });
    }
  }

  // Dependency resolution check.
  for (const [name, entry] of sections) {
    for (const dep of entry.spec.dependencies ?? []) {
      if (!sections.has(dep)) {
        const msg = `section '${name}' depends on '${dep}' which is not in the composed template for scope '${scope}'`;
        if (opts.strict) {
          throw new Error(`[agent-contract-registry] ${msg}`);
        }
        warnings.push(msg);
      }
    }
  }

  const signature = computeSignature(scope, sections);

  return { scope, sections, signature, warnings };
}

/**
 * Convenience: compose templates for every canonical `StoryScope`. Useful
 * for CI assertions ("compose every scope without conflicts") and for the
 * dashboard `/contracts` page.
 */
export function composeAllScopes(
  opts: ComposeOptions = {},
): Record<StoryScope, ComposedTemplate> {
  const out: Partial<Record<StoryScope, ComposedTemplate>> = {};
  for (const scope of [
    'initiative',
    'epic',
    'module',
    'story',
    'task',
    'subtask',
  ] as const) {
    out[scope] = composeTemplate(scope, opts);
  }
  return out as Record<StoryScope, ComposedTemplate>;
}
