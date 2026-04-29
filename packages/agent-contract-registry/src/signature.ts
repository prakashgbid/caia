/**
 * @chiefaia/agent-contract-registry — signature.ts (ACR-002)
 *
 * Stable hash over the composed template — used as the Validator's cache
 * key and for drift detection in CI snapshot tests. Two compositions with
 * the same signature produce identical Validator behaviour.
 *
 * The signature is content-derived only — it does NOT include scope or
 * agent ordering metadata, since those are inputs that already determine
 * the section set. Two scopes producing the same composed sections will
 * have the same signature (rare but harmless).
 *
 * Implementation: SHA-256 over a JSON-stable normalisation of the
 * sections map. We use Node's built-in `crypto` to avoid adding a hash
 * dependency.
 */

import { createHash } from 'node:crypto';
import type { ComposedSectionEntry, StoryScope } from '@chiefaia/ticket-template';

/**
 * Normalise a `ComposedSectionEntry` for hashing — strip the ZodTypeAny
 * (not stably JSON-serialisable across runs), keep everything else.
 */
function normaliseEntry(entry: ComposedSectionEntry): unknown {
  return {
    name: entry.spec.name,
    ownerAgent: entry.ownerAgent,
    contractId: entry.contractId,
    effectiveRequired: entry.effectiveRequired,
    description: entry.spec.description,
    purpose: entry.spec.purpose,
    dependencies: [...(entry.spec.dependencies ?? [])].sort(),
    rubric: {
      minWords: entry.effectiveRubric.minWords ?? null,
      minItems: entry.effectiveRubric.minItems ?? null,
      minItemsPerSubField: entry.effectiveRubric.minItemsPerSubField
        ? Object.fromEntries(
            Object.entries(entry.effectiveRubric.minItemsPerSubField).sort(),
          )
        : null,
      requiredSubFields: [...(entry.effectiveRubric.requiredSubFields ?? [])].sort(),
      requiredEntityRefs: (entry.effectiveRubric.requiredEntityRefs ?? []).map((r) => ({
        label: r.label,
        pattern: r.pattern,
        flags: r.flags ?? '',
      })),
      forbiddenSnippets: [...(entry.effectiveRubric.forbiddenSnippets ?? [])].sort(),
      relevancePromptSeed: entry.effectiveRubric.relevancePromptSeed ?? null,
      severityOnFail: entry.effectiveRubric.severityOnFail,
      fixHint: entry.effectiveRubric.fixHint,
    },
  };
}

/**
 * Compute a stable SHA-256 signature over the composed template. The
 * scope is included in the hash input so identical section sets across
 * scopes still produce distinct signatures (cleaner cache semantics).
 */
export function computeSignature(
  scope: StoryScope,
  sections: ReadonlyMap<string, ComposedSectionEntry>,
): string {
  // Stable section order: alphabetical by name.
  const orderedNames = [...sections.keys()].sort();
  const payload = {
    scope,
    sections: orderedNames.map((name) => normaliseEntry(sections.get(name)!)),
  };
  const json = JSON.stringify(payload);
  return createHash('sha256').update(json).digest('hex');
}
