/**
 * /api/contracts — Agent Section Contract Registry dashboard backend
 * (ACR-009).
 *
 * Two surfaces consumed by the dashboard's /contracts page:
 *
 *   GET /api/contracts/registry
 *     -> array of every registered SectionContract (id, owner, version,
 *        appliesTo, section count, signature)
 *
 *   GET /api/contracts/composed/:scope
 *     -> the composed template for a given StoryScope, including each
 *        section's owner, effective rubric, dependencies, examples,
 *        and the composition signature + warnings
 *
 * Both routes call bootstrapAgentContracts() so the registry is always
 * populated regardless of orchestrator boot order.
 */

import type { Hono } from 'hono';
import { composeTemplate } from '@chiefaia/agent-contract-registry';
import { STORY_SCOPES, isStoryScope } from '@chiefaia/ticket-template';
import { bootstrapAgentContracts } from '../../agents/contract-bootstrap';

// @no-events — observability route surfaces, no domain mutations
export function registerContractsRoutes(app: Hono): void {
  app.get('/api/contracts/registry', (c) => {
    const reg = bootstrapAgentContracts();
    const entries = reg.list().map((contract) => ({
      contractId: contract.contractId,
      ownerAgent: contract.ownerAgent,
      version: contract.version,
      appliesTo: [...contract.appliesTo],
      sectionCount: contract.sections.length,
      sectionNames: contract.sections.map((s) => s.name),
    }));
    return c.json({ contracts: entries, count: entries.length });
  });

  app.get('/api/contracts/composed/:scope', (c) => {
    const rawScope = c.req.param('scope');
    if (!isStoryScope(rawScope)) {
      return c.json(
        {
          error: `invalid scope '${rawScope}'`,
          allowedScopes: [...STORY_SCOPES],
        },
        400,
      );
    }
    bootstrapAgentContracts();
    const template = composeTemplate(rawScope);
    const sections = [...template.sections.entries()].map(([name, entry]) => ({
      name,
      ownerAgent: entry.ownerAgent,
      contractId: entry.contractId,
      effectiveRequired: entry.effectiveRequired,
      description: entry.spec.description,
      purpose: entry.spec.purpose,
      dependencies: [...(entry.spec.dependencies ?? [])],
      effectiveRubric: {
        minWords: entry.effectiveRubric.minWords ?? null,
        minItems: entry.effectiveRubric.minItems ?? null,
        severityOnFail: entry.effectiveRubric.severityOnFail,
        fixHint: entry.effectiveRubric.fixHint,
        forbiddenSnippets: [...(entry.effectiveRubric.forbiddenSnippets ?? [])],
        requiredEntityRefs: [...(entry.effectiveRubric.requiredEntityRefs ?? [])],
      },
      exampleCount: entry.spec.examples.length,
    }));
    return c.json({
      scope: template.scope,
      signature: template.signature,
      sections,
      warnings: [...template.warnings],
      sectionCount: sections.length,
    });
  });

  app.get('/api/contracts/composed-all', (c) => {
    bootstrapAgentContracts();
    const out: Record<string, { signature: string; sectionCount: number; warnings: string[] }> = {};
    for (const scope of STORY_SCOPES) {
      const t = composeTemplate(scope);
      out[scope] = {
        signature: t.signature,
        sectionCount: t.sections.size,
        warnings: [...t.warnings],
      };
    }
    return c.json({ scopes: out });
  });
}
