/**
 * @caia/info-architect — system-prompt builder.
 *
 * Composes the prompt the IA agent hands to the Claude binary via
 * `@chiefaia/claude-spawner`. Two contracts the prompt enforces:
 *
 *  1. **11 IA pillars** (per IA spec §9): routes, page templates, section
 *     stacks, slider patterns, card variants, atomic design, tokens
 *     (color/typography/spacing/motion), light+dark themes, a11y
 *     landmarks, SEO per-route, routing rules, component-library
 *     selection (shadcn-locked per ADR-061).
 *
 *  2. **5 credential-UI archetypes** (per `personal/chiefaia-com-design-
 *     prompt.md` §11.3): the IA agent MUST catalogue these as named
 *     organism-tier primitives in `componentsLibrary` so the onboarding
 *     wizard renders consistent UI per credential category:
 *
 *       A — OAuth code-grant
 *       B — API token (PAT-style)
 *       C — DNS-based proof of control
 *       D — Webhook receipt
 *       E — Database / SMTP / SSH endpoint reach
 *
 * Wave-1 keeps the prompt compact (≈4-6 KB) — the full ~25k-word
 * playbook is deferred to `@caia/info-architect-playbook` (Wave 2).
 */

import type { IaInput, ProjectType } from './types.js';

export interface BuildIaSystemPromptOptions {
  /** Override the default model hint that ends up in the brief. */
  readonly modelHint?: 'opus' | 'sonnet' | 'haiku';
  /** Inject extra operator instructions verbatim. */
  readonly extraInstructions?: readonly string[];
  /** Optional override of the catalogue version recorded in artifacts. */
  readonly catalogueVersion?: string;
}

/** The 11 IA pillars enumerated per spec §9. Kept as a readonly tuple so
 * tests can assert exact ordering / count. */
export const IA_PILLARS: readonly string[] = Object.freeze([
  'Pillar 1 — Routes & Sitemap',
  'Pillar 2 — Page Templates',
  'Pillar 3 — Section Stacks',
  'Pillar 4 — Slider Patterns',
  'Pillar 5 — Card Variants',
  'Pillar 6 — Atomic Design',
  'Pillar 7 — Color / Typography / Spacing / Motion Tokens',
  'Pillar 8 — Light + Dark Themes',
  'Pillar 9 — A11y Landmarks',
  'Pillar 10 — SEO per Route',
  'Pillar 11 — Routing Rules & Component-Library Selection (shadcn-locked)',
]);

/**
 * The 5 credential-UI archetypes (A-E) from
 * `personal/chiefaia-com-design-prompt.md` §11.3.
 *
 * Each archetype must be catalogued as a stable organism-tier primitive in
 * `componentsLibrary`. The IA agent attaches `credentialArchetype` to the
 * matching `ComponentRecord` so downstream codegen can instantiate the
 * right form variant per onboarding-wizard category.
 */
export interface CredentialArchetypeDescriptor {
  readonly id: 'A' | 'B' | 'C' | 'D' | 'E';
  readonly key:
    | 'oauth-code-grant'
    | 'api-token'
    | 'dns-proof-of-control'
    | 'webhook-receipt'
    | 'db-smtp-ssh-endpoint-reach';
  readonly title: string;
  readonly description: string;
}

export const CREDENTIAL_ARCHETYPES: readonly CredentialArchetypeDescriptor[] =
  Object.freeze([
    {
      id: 'A',
      key: 'oauth-code-grant',
      title: 'OAuth code-grant',
      description:
        'Big primary "Connect with <Provider>" button (full-width on mobile; 320px-wide on desktop, accent-color filled, 48px tall). After click → opens provider OAuth in a new tab. After callback returns → scope checklist with green/red marks per required scope.',
    },
    {
      id: 'B',
      key: 'api-token',
      title: 'API token (PAT-style)',
      description:
        'Paste field (monospace, password-input by default with eye toggle). Helper text shows the provider\'s "create token" deep-link with required scopes pre-selected. Async submit with 60s timeout. SSE log streams probe response.',
    },
    {
      id: 'C',
      key: 'dns-proof-of-control',
      title: 'DNS-based proof of control',
      description:
        'Three regions: a "domain you control" input, a copy-to-clipboard DNS-record box (TXT or CNAME), and a polling status pill with live re-check button. 10-minute timeout. The most distinctive UI of the five.',
    },
    {
      id: 'D',
      key: 'webhook-receipt',
      title: 'Webhook receipt',
      description:
        'Two regions: a copy-to-clipboard "send your webhook to this URL" box, and a live log of received-but-not-yet-verified payloads. Customer triggers a webhook from their side; CAIA marks the category passed when a signed payload arrives.',
    },
    {
      id: 'E',
      key: 'db-smtp-ssh-endpoint-reach',
      title: 'Database / SMTP / SSH endpoint reach',
      description:
        'Static outbound-IP display at the top ("Our outbound IP is `1.2.3.4`. Add it to your allow-list."), DSN/host/port form (monospace inputs), optional CA-bundle paste field, "Test connection" button that streams SELECT 1 / EHLO / SSH-2.0-banner exchange to the right rail.',
    },
  ]);

/**
 * Build the system prompt the IA agent hands to Claude. Deterministic
 * given identical inputs.
 */
export function buildIaSystemPrompt(
  input: IaInput,
  options: BuildIaSystemPromptOptions = {},
): string {
  const sections: string[] = [];

  sections.push(
    '# Information Architect Agent — system prompt',
    '',
    'You are the **Information Architect (IA) Agent**, Step 3.5 in CAIA\'s canonical pipeline (ADR-024, ratified 2026-05-25).',
    '',
    'Your job is to consume the supplied `BusinessPlanV2` projection and tenant context, deliberate across the 11 IA pillars below, and emit three canonical structural artifacts:',
    '',
    '  1. `pagesCatalogue` — sitemap + page templates + ordered section stacks + widget references',
    '  2. `designSystem` — tokens (color/typography/spacing/motion), light + dark themes, Tailwind config',
    '  3. `componentsLibrary` — Atomic-Design catalogue where every component has a stable globally-unique id',
    '',
    'You are subscription-only. Do not assume API-key billing.',
    '',
  );

  sections.push(
    '## Project context',
    '',
    `- Project id: ${input.projectId}`,
    `- Tenant: ${input.tenantContext.tenantName} (${input.tenantContext.tenantSlug})`,
    `- Project type: ${describeProjectType(input.projectType)}`,
    `- BusinessPlanV2 revision: ${input.businessPlan.revisionId}`,
    `- BusinessPlanV2 completeness score: ${String(input.businessPlan.completenessScore)}`,
    '',
    '### Value proposition',
    input.businessPlan.valueProposition,
    '',
    '### Target user',
    input.businessPlan.targetUser,
    '',
    '### Brand voice / design disposition',
    input.businessPlan.brandVoiceDesign,
    '',
  );

  sections.push('## 11 IA pillars (mandatory coverage)', '');
  for (const pillar of IA_PILLARS) {
    sections.push(`- ${pillar}`);
  }
  sections.push('');

  sections.push(
    '## Stack lock',
    '',
    'Per `agent-memory/project_caia_shadcn_react_first_locked.md` (ADR-061):',
    '',
    '- `projectType === \'admin\'` → codegen imports from `@stolution/ui-shadcn`.',
    '- `projectType === \'client\'` → codegen uses shadcn primitives via `@website-factory/components` (or copied per shadcn convention).',
    '',
    'Use shadcn primitives and compose for non-trivial widgets (§4.4). The `tailwindConfig` field in `designSystem` MUST mirror the Tailwind v3 `theme.extend` shape. Every component entry in `componentsLibrary` MUST name a real shadcn component in `shadcnComponent` when applicable.',
    '',
  );

  sections.push(
    '## 5 credential-UI archetypes (mandatory coverage in `componentsLibrary`)',
    '',
    'Per `personal/chiefaia-com-design-prompt.md` §11.3. Every IA run MUST emit one organism-tier component per archetype with the matching `credentialArchetype` field set:',
    '',
  );
  for (const a of CREDENTIAL_ARCHETYPES) {
    sections.push(
      `### Archetype ${a.id} — ${a.title} (\`credentialArchetype: '${a.key}'\`)`,
      a.description,
      '',
    );
  }

  sections.push(
    '## Output format',
    '',
    'Return a single JSON object with exactly these top-level keys: `pagesCatalogue`, `designSystem`, `componentsLibrary`. Each value must match the schema described above. Do not include extra keys. Do not omit required keys.',
    '',
    'Every component in `componentsLibrary.components` must have a globally-unique `id` of the form `cmp-<atomic-tier>-<slug>`. Every page in `pagesCatalogue.pages` must have a `slug` matching `^[a-z0-9-]+$` (this becomes the DOM-ID prefix consumed by Atlas).',
    '',
  );

  if (options.extraInstructions && options.extraInstructions.length > 0) {
    sections.push('## Operator extras', '');
    for (const ins of options.extraInstructions) {
      sections.push(`- ${ins}`);
    }
    sections.push('');
  }

  if (options.modelHint !== undefined) {
    sections.push(`<!-- model-hint: ${options.modelHint} -->`, '');
  }
  if (options.catalogueVersion !== undefined) {
    sections.push(`<!-- catalogue-version: ${options.catalogueVersion} -->`, '');
  }

  return sections.join('\n');
}

function describeProjectType(t: ProjectType): string {
  return t === 'admin'
    ? 'admin (operator/internal — codegen via @stolution/ui-shadcn)'
    : 'client (customer-facing — shadcn primitives via @website-factory/components)';
}
