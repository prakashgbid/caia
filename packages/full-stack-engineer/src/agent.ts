/**
 * `@caia/full-stack-engineer/agent` — subagent system prompt + prompt builder.
 *
 * The Full-Stack Engineer subagent runs under `@chiefaia/claude-spawner`
 * with the prompt produced here. The system prompt encodes the worker's
 * non-negotiable contract:
 *
 *   1. Senior full-stack engineer voice.
 *   2. Implement EXACTLY what the 17 architects + Test Author specified.
 *      No deviation. No "improvements". No re-architecture.
 *   3. shadcn/ui + Tailwind ONLY for frontend
 *      (per `[[project-caia-shadcn-react-first-locked]]`).
 *   4. Test cases authored by the Test Author Agent must be satisfied
 *      verbatim — selector hints, layer, category preserved.
 *   5. PR body MUST reference the ticket id + list which architects'
 *      specs were satisfied.
 *   6. Stop only at `[result] DONE: <summary>` or
 *      `[result] FAILED: <reason>`.
 *
 * The prompt is also useful directly when callers want to issue an
 * out-of-band `claude -p` invocation (e.g. for the Principal Engineer
 * to debug a single worker without going through the full orchestration).
 */

import type { ImplementationBrief, TestsBriefSection } from './types.js';

/**
 * The system prompt prepended to every Full-Stack Engineer spawn.
 * Token-budget friendly; no XML/Markdown noise the model has to skip.
 */
export const FULL_STACK_ENGINEER_SYSTEM_PROMPT = `You are the CAIA Full-Stack Engineer (Stage 13 of the canonical pipeline).

You are a senior full-stack engineer. You implement EXACTLY the specs handed to you by the 17 specialist architects and the Test Author Agent. Your role is execution, not architecture — you do not re-design, re-scope, or "improve" the spec.

## Hard rules (non-negotiable)

1. ZERO deviation from acceptance criteria. Every acceptance criterion must be satisfied verbatim.
2. ZERO deviation from the architect-supplied component tree, endpoint list, migration SQL, or service shape. You implement what they wrote.
3. Frontend stack is LOCKED to shadcn/ui + Tailwind. Imports come from \`@/components/ui/*\` (shadcn registry path) and styles are Tailwind utility classes ONLY. NO CSS-in-JS. NO styled-components. NO MUI. NO bespoke .css files unless an architect explicitly emitted one in their spec.
4. Test cases authored by the Test Author Agent are LAW. Implement against them exactly: same case ids, same selector hints, same layer/category.
5. Subscription-only — you are spawned via \`@chiefaia/claude-spawner\` and have no API-token billing path.
6. PR body MUST cite the ticket id and list the architects whose specs were satisfied (one bullet each, in precedence order).
7. Conventional commits ONLY — \`feat(<scope>): ...\`, \`fix(<scope>): ...\`, \`chore(<scope>): ...\`. One commit per acceptance-criterion group.
8. STOP only at \`[result] DONE: <summary>\` (PR opened, local gate green) or \`[result] FAILED: <reason>\` (structural failure, e.g. spec contradiction, missing dependency, stack-lock violation that cannot be resolved without changing the spec).

## What you produce

Your response is a JSON file plan with these top-level keys:

  {
    "frontend": [{ "path": "...", "contents": "...", "attribution": ["frontend-architect", ...] }, ...],
    "backend":  [{ "path": "...", "contents": "...", "attribution": [...] }, ...],
    "database": [{ "path": "...", "contents": "...", "attribution": [...] }, ...],
    "tests":    [{ "path": "...", "contents": "...", "attribution": [...] }, ...]
  }

Each \`contents\` is the FULL file body (no diffs, no patches). Paths are relative to the project repo root. Attribution is a list of architect names (e.g. "frontend-architect", "database-architect", "accessibility-architect") whose specs this file fulfils.

## What you do NOT produce

- New ADRs or architecture decisions. Escalate via \`[result] FAILED\` if the spec is internally contradictory.
- Pricing, vendor, or platform-of-record changes. Stop with \`[result] FAILED\` if the spec demands one.
- README rewrites unrelated to the ticket.
- Refactors of code outside the ticket-scoped file allowlist.
- Documentation that wasn't requested in the brief.

## Quality gate (you run this before stopping)

- \`pnpm -F <package> typecheck\` clean
- \`pnpm -F <package> lint\` clean
- \`pnpm -F <package> vitest run\` green for tests you authored

If any local-gate step fails, fix the file and re-run. Do not declare \`[result] DONE\` until the gate is fully green.

## Tone

Direct. No filler. No "let me know if you need...". No emojis (unless the architect explicitly emitted one in copy). One sentence per acceptance criterion in the PR body.

End every run with the stop marker on its own line.`;

/**
 * Build the per-ticket prompt fed into the spawned subagent. The prompt
 * is the concatenation of the system instructions (passed via the
 * binary's system-prompt flag in production; embedded here for spawner
 * paths that don't separate system vs. user roles) and the ticket
 * brief rendered as deterministic Markdown.
 */
export function buildEngineerPrompt(brief: ImplementationBrief): string {
  const parts: string[] = [];
  parts.push(`# Ticket ${brief.ticketId} — ${brief.ticketTitle}`);
  parts.push('');
  parts.push(`Project: \`${brief.projectId}\``);
  parts.push('');

  parts.push('## Acceptance criteria');
  parts.push('');
  if (brief.acceptanceCriteria.length === 0) {
    parts.push('_(no acceptance criteria authored — escalate via [result] FAILED)_');
  } else {
    for (const ac of brief.acceptanceCriteria) parts.push(`- ${ac}`);
  }
  parts.push('');

  parts.push('## Stack lock');
  parts.push('');
  parts.push(`- UI primitives: ${brief.stackLock.uiPrimitives}`);
  parts.push(`- Styling: ${brief.stackLock.styling}`);
  parts.push(`- shadcn-react-first locked: ${String(brief.stackLock.shadcnReactFirst)}`);
  parts.push('- Forbidden import patterns:');
  for (const f of brief.stackLock.forbidden) parts.push(`  - \`${f}\``);
  parts.push('');

  parts.push('## Frontend');
  parts.push('');
  parts.push(renderComponentTree(brief.frontend.componentTree));
  parts.push(renderRoutes(brief.frontend.routes));
  parts.push(renderStateModules(brief.frontend.stateModules));
  if (brief.frontend.tokens && Object.keys(brief.frontend.tokens).length > 0) {
    parts.push('### Design tokens (Tailwind theme overrides)');
    parts.push('');
    parts.push('```json');
    parts.push(JSON.stringify(brief.frontend.tokens, null, 2));
    parts.push('```');
    parts.push('');
  }

  parts.push('## Backend');
  parts.push('');
  parts.push(renderEndpoints(brief.backend.endpoints));
  parts.push(renderServices(brief.backend.services));
  if (brief.backend.authConstraints.length > 0) {
    parts.push('### Auth / authz constraints');
    parts.push('');
    for (const c of brief.backend.authConstraints) parts.push(`- ${c}`);
    parts.push('');
  }

  parts.push('## Database');
  parts.push('');
  parts.push(renderMigrations(brief.database.migrations));
  parts.push(renderRepositories(brief.database.repositories));

  parts.push('## Tests');
  parts.push('');
  parts.push(renderTests(brief.tests));

  if (anyCrosscutting(brief.crosscutting)) {
    parts.push('## Crosscutting');
    parts.push('');
    parts.push(renderCrosscutting(brief.crosscutting));
  }

  if (brief.miscArchitectNotes.length > 0) {
    parts.push('## Misc architect notes');
    parts.push('');
    for (const n of brief.miscArchitectNotes) parts.push(`- **${n.architect}**: ${n.note}`);
    parts.push('');
  }

  parts.push('---');
  parts.push('');
  parts.push('Emit the JSON file plan now, then stop with `[result] DONE: …` or `[result] FAILED: …`.');

  return parts.join('\n');
}

// ─── Renderers ────────────────────────────────────────────────────────────

function renderComponentTree(specs: ImplementationBrief['frontend']['componentTree']): string {
  if (specs.length === 0) return '_(no component tree)_\n';
  const lines: string[] = ['### Component tree', ''];
  for (const c of specs) {
    lines.push(`- \`${c.path}\` — \`${c.componentName}\``);
    if (c.shadcnPrimitives.length > 0) {
      lines.push(`  - shadcn primitives: ${c.shadcnPrimitives.map((p) => `\`${p}\``).join(', ')}`);
    }
    if (c.anchors.length > 0) {
      lines.push(`  - anchors: ${c.anchors.map((a) => `\`${a}\``).join(', ')}`);
    }
    if (c.notes) lines.push(`  - notes: ${c.notes}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderRoutes(specs: ImplementationBrief['frontend']['routes']): string {
  if (specs.length === 0) return '';
  const lines: string[] = ['### Routes', ''];
  for (const r of specs) {
    const kind = r.serverComponent === false ? 'client' : 'server';
    lines.push(`- \`${r.path}\` → \`${r.rendersComponent}\` (${kind})${r.layoutClass ? ` — layout: \`${r.layoutClass}\`` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderStateModules(specs: ImplementationBrief['frontend']['stateModules']): string {
  if (specs.length === 0) return '';
  const lines: string[] = ['### State modules', ''];
  for (const s of specs) {
    lines.push(`- \`${s.path}\` — \`${s.storeName}\` (slices: ${s.sliceKeys.map((k) => `\`${k}\``).join(', ')})`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderEndpoints(specs: ImplementationBrief['backend']['endpoints']): string {
  if (specs.length === 0) return '_(no endpoints)_\n';
  const lines: string[] = ['### Endpoints', ''];
  for (const e of specs) {
    lines.push(`- \`${e.method} ${e.path}\` → \`${e.handlerPath}\``);
    lines.push(`  - request: \`${e.requestShape}\``);
    lines.push(`  - response: \`${e.responseShape}\``);
    if (e.notes) lines.push(`  - notes: ${e.notes}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderServices(specs: ImplementationBrief['backend']['services']): string {
  if (specs.length === 0) return '';
  const lines: string[] = ['### Services', ''];
  for (const s of specs) {
    lines.push(`- \`${s.path}\` — \`${s.serviceName}\`${s.notes ? ` — ${s.notes}` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderMigrations(specs: ImplementationBrief['database']['migrations']): string {
  if (specs.length === 0) return '_(no migrations)_\n';
  const lines: string[] = ['### Migrations', ''];
  for (const m of specs) {
    lines.push(`- \`${m.filename}\`${m.notes ? ` — ${m.notes}` : ''}`);
    lines.push('  ```sql');
    for (const sqlLine of m.sql.split('\n')) lines.push(`  ${sqlLine}`);
    lines.push('  ```');
  }
  lines.push('');
  return lines.join('\n');
}

function renderRepositories(specs: ImplementationBrief['database']['repositories']): string {
  if (specs.length === 0) return '';
  const lines: string[] = ['### Repositories', ''];
  for (const r of specs) {
    lines.push(`- \`${r.path}\` — \`${r.repoName}\`${r.notes ? ` — ${r.notes}` : ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderTests(section: TestsBriefSection): string {
  const lines: string[] = ['### Test cases (LAW — implement against these exactly)', ''];
  if (section.cases.length === 0) {
    lines.push('_(no test cases authored)_');
  } else {
    for (const tc of section.cases) {
      lines.push(`- \`${tc.id}\` [${tc.layer}/${tc.category}] — ${tc.title}`);
      if (tc.selectorHints && tc.selectorHints.length > 0) {
        lines.push(`  - selectors: ${tc.selectorHints.map((s) => `\`${s}\``).join(', ')}`);
      }
      if ('required' in tc && tc.required === false) lines.push('  - required: false');
    }
  }
  lines.push('');
  lines.push('### Local gate');
  lines.push('');
  lines.push(`- typecheck: ${section.localGate.typecheck ? 'required' : 'skip'}`);
  lines.push(`- lint: ${section.localGate.lint ? 'required' : 'skip'}`);
  lines.push(`- vitest: ${section.localGate.vitest ? 'required' : 'skip'}`);
  lines.push('');
  return lines.join('\n');
}

function renderCrosscutting(c: ImplementationBrief['crosscutting']): string {
  const lines: string[] = [];
  const sections: Array<[string, readonly string[]]> = [
    ['Accessibility', c.accessibility],
    ['Performance budgets', c.performanceBudgets],
    ['Observability', c.observability],
    ['Security', c.security],
    ['i18n', c.i18n],
    ['SEO', c.seo],
  ];
  for (const [label, items] of sections) {
    if (items.length === 0) continue;
    lines.push(`### ${label}`);
    lines.push('');
    for (const it of items) lines.push(`- ${it}`);
    lines.push('');
  }
  return lines.join('\n');
}

function anyCrosscutting(c: ImplementationBrief['crosscutting']): boolean {
  return (
    c.accessibility.length > 0 ||
    c.performanceBudgets.length > 0 ||
    c.observability.length > 0 ||
    c.security.length > 0 ||
    c.i18n.length > 0 ||
    c.seo.length > 0
  );
}
