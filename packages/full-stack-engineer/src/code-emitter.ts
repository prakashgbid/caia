/**
 * `@caia/full-stack-engineer/code-emitter` — produces frontend +
 * backend + database + tests files from an ImplementationBrief.
 *
 * Two implementations are exported:
 *
 *   - `createSpawnedEmitter(opts)` — production. Calls `spawnClaude()`
 *     from `@chiefaia/claude-spawner` with the system prompt declared
 *     in `agent.ts`, parses the assistant's structured JSON file plan,
 *     validates it against the stack lock, and returns the EmittedFiles.
 *     Subscription-only by construction (the spawner scrubs API-token
 *     env vars unconditionally).
 *
 *   - `createDeterministicEmitter()` — test / fallback. Pure transform
 *     from brief → files using shadcn/ui + Tailwind scaffolds. Useful
 *     for tests, dry-runs, and the integration test. Also useful as a
 *     fallback when the spawned subagent times out: the worker can
 *     attempt the deterministic emit, mark the resulting PR as a
 *     scaffold, and let the next iteration fill in the bodies.
 */

import {
  parseClaudeJsonEnvelope,
  spawnClaude,
} from '@chiefaia/claude-spawner';
import type {
  SpawnClaudeOptions,
  SpawnClaudeResult,
} from '@chiefaia/claude-spawner';

import {
  FULL_STACK_ENGINEER_SYSTEM_PROMPT,
  buildEngineerPrompt,
} from './agent.js';
import { findStackLockViolations } from './spec-reader.js';
import type {
  ComponentSpec,
  Emitter,
  EmittedFile,
  EmittedFiles,
  EndpointSpec,
  ImplementationBrief,
  MigrationSpec,
} from './types.js';

// ─── Public: spawned emitter ──────────────────────────────────────────────

export interface SpawnedEmitterOptions {
  /** Optional override of the spawnClaude function (test seam). */
  spawnFn?: typeof spawnClaude;
  /** Pass-through to spawnClaude. */
  spawnOptions?: SpawnClaudeOptions;
  /**
   * If the spawned subagent fails (timeout, malformed envelope, stack-
   * lock violation), should we fall back to the deterministic emitter?
   * Default: false — fail loudly so the worker surfaces a structured
   * failure.
   */
  fallbackToDeterministic?: boolean;
}

export class EmitterError extends Error {
  readonly code:
    | 'spawn-failed'
    | 'envelope-malformed'
    | 'file-plan-missing'
    | 'file-plan-invalid'
    | 'stack-lock-violation';
  readonly diagnostic: string | null;
  constructor(
    code:
      | 'spawn-failed'
      | 'envelope-malformed'
      | 'file-plan-missing'
      | 'file-plan-invalid'
      | 'stack-lock-violation',
    message: string,
    diagnostic: string | null = null,
  ) {
    super(message);
    this.name = 'EmitterError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export function createSpawnedEmitter(opts: SpawnedEmitterOptions = {}): Emitter {
  const spawnFn = opts.spawnFn ?? spawnClaude;
  return {
    async emit(brief: ImplementationBrief): Promise<EmittedFiles> {
      const userPrompt = buildEngineerPrompt(brief);
      const fullPrompt = `${FULL_STACK_ENGINEER_SYSTEM_PROMPT}\n\n${userPrompt}`;
      let spawnResult: SpawnClaudeResult;
      try {
        spawnResult = await spawnFn({
          prompt: fullPrompt,
          options: opts.spawnOptions ?? {},
        });
      } catch (err) {
        if (opts.fallbackToDeterministic === true) {
          return createDeterministicEmitter().emit(brief);
        }
        throw new EmitterError(
          'spawn-failed',
          `spawn threw: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!spawnResult.ok) {
        if (opts.fallbackToDeterministic === true) {
          return createDeterministicEmitter().emit(brief);
        }
        throw new EmitterError('spawn-failed', spawnResult.diagnostic ?? 'spawn failed');
      }
      const envelope = parseClaudeJsonEnvelope(spawnResult.stdout);
      if (!envelope.ok) {
        if (opts.fallbackToDeterministic === true) {
          return createDeterministicEmitter().emit(brief);
        }
        throw new EmitterError(
          'envelope-malformed',
          envelope.diagnostic,
          spawnResult.stdout.slice(0, 500),
        );
      }
      const filesUnknown = extractFilePlan(envelope.text);
      if (filesUnknown === null) {
        if (opts.fallbackToDeterministic === true) {
          return createDeterministicEmitter().emit(brief);
        }
        throw new EmitterError(
          'file-plan-missing',
          'no JSON file plan in assistant output',
          envelope.text.slice(0, 500),
        );
      }
      const validated = validateFilePlan(filesUnknown);
      if (!validated.ok) {
        if (opts.fallbackToDeterministic === true) {
          return createDeterministicEmitter().emit(brief);
        }
        throw new EmitterError('file-plan-invalid', validated.diagnostic);
      }
      // Stack-lock guard runs on every emit regardless of source.
      const all = [
        ...validated.files.frontend,
        ...validated.files.backend,
        ...validated.files.database,
        ...validated.files.tests,
      ];
      const violations = findStackLockViolations(all);
      if (violations.length > 0) {
        throw new EmitterError(
          'stack-lock-violation',
          `${violations.length} stack-lock violation(s)`,
          JSON.stringify(violations),
        );
      }
      return validated.files;
    },
  };
}

// ─── Public: deterministic emitter ────────────────────────────────────────

/**
 * Pure transform: brief → file scaffolds. Used by tests and by the
 * fallback path when the spawned subagent fails. The output is small
 * but valid (typechecks, lints, and the test scaffolds parse) so the
 * downstream PR opens cleanly.
 */
export function createDeterministicEmitter(): Emitter {
  return {
    async emit(brief: ImplementationBrief): Promise<EmittedFiles> {
      return {
        frontend: emitFrontendFiles(brief),
        backend: emitBackendFiles(brief),
        database: emitDatabaseFiles(brief),
        tests: emitTestFiles(brief),
      };
    },
  };
}

// ─── Deterministic file scaffolds ─────────────────────────────────────────

function emitFrontendFiles(brief: ImplementationBrief): readonly EmittedFile[] {
  const out: EmittedFile[] = [];
  for (const c of brief.frontend.componentTree) {
    out.push(scaffoldComponent(c));
  }
  for (const r of brief.frontend.routes) {
    out.push({
      path: r.path,
      contents: scaffoldRouteFile(r.rendersComponent, r.layoutClass, r.serverComponent),
      attribution: ['frontend-architect'],
    });
  }
  for (const s of brief.frontend.stateModules) {
    out.push({
      path: s.path,
      contents: scaffoldStateModule(s.storeName, s.sliceKeys),
      attribution: ['frontend-architect'],
    });
  }
  if (brief.frontend.tokens && Object.keys(brief.frontend.tokens).length > 0) {
    out.push({
      path: 'tailwind.theme.generated.ts',
      contents: `// Auto-generated from ticket ${brief.ticketId}\nexport const themeTokens = ${JSON.stringify(brief.frontend.tokens, null, 2)} as const;\n`,
      attribution: ['frontend-architect'],
    });
  }
  return out;
}

function scaffoldComponent(c: ComponentSpec): EmittedFile {
  const primitiveImports = c.shadcnPrimitives
    .map((p) => `import { ${pascalCase(p)} } from '@/components/ui/${kebabCase(p)}';`)
    .join('\n');
  const anchorsAttr = c.anchors.length > 0
    ? c.anchors.map((a) => `data-anchor-${escapeAttr(a)}=""`).join(' ')
    : '';
  const contents = `${primitiveImports}${primitiveImports ? '\n\n' : ''}export interface ${c.componentName}Props {
  /** Architect notes: ${c.notes || '_(none)_'} */
  className?: string;
}

export function ${c.componentName}(props: ${c.componentName}Props): JSX.Element {
  return (
    <div className={['rounded-md', 'border', 'bg-card', 'text-card-foreground', 'p-4', props.className ?? ''].filter(Boolean).join(' ')} ${anchorsAttr}>
      {/* TODO: implement per architect spec — ticket-scoped emitter scaffold. */}
    </div>
  );
}
`;
  return {
    path: c.path,
    contents,
    attribution: ['frontend-architect'],
  };
}

function scaffoldRouteFile(componentPath: string, layoutClass?: string, serverComponent?: boolean): string {
  const clientDirective = serverComponent === false ? `'use client';\n\n` : '';
  const importedName = pascalCase(extractBaseName(componentPath));
  const layoutAttr = layoutClass ? `className="${escapeAttr(layoutClass)}"` : 'className="container mx-auto p-4"';
  return `${clientDirective}import { ${importedName} } from '${componentPath.replace(/\.(tsx?|jsx?)$/i, '')}';

export default function Page(): JSX.Element {
  return (
    <main ${layoutAttr}>
      <${importedName} />
    </main>
  );
}
`;
}

function scaffoldStateModule(storeName: string, sliceKeys: readonly string[]): string {
  const sliceType = sliceKeys.length > 0
    ? sliceKeys.map((k) => `  ${k}: unknown;`).join('\n')
    : '  // no slices declared';
  const sliceInit = sliceKeys.length > 0
    ? sliceKeys.map((k) => `  ${k}: undefined,`).join('\n')
    : '';
  return `// Auto-generated state module
export interface ${storeName}State {
${sliceType}
}

const initial: ${storeName}State = {
${sliceInit}
};

export function create${storeName}(): { getState(): ${storeName}State; setState(next: Partial<${storeName}State>): void } {
  let state: ${storeName}State = { ...initial };
  return {
    getState: () => state,
    setState: (next) => {
      state = { ...state, ...next };
    },
  };
}
`;
}

function emitBackendFiles(brief: ImplementationBrief): readonly EmittedFile[] {
  const out: EmittedFile[] = [];
  for (const e of brief.backend.endpoints) {
    out.push({
      path: e.handlerPath,
      contents: scaffoldEndpoint(e, brief.backend.authConstraints),
      attribution: ['backend-architect', 'security-architect'],
    });
  }
  for (const s of brief.backend.services) {
    out.push({
      path: s.path,
      contents: scaffoldService(s.serviceName, s.notes),
      attribution: ['backend-architect'],
    });
  }
  return out;
}

function scaffoldEndpoint(e: EndpointSpec, authConstraints: readonly string[]): string {
  const authBlock = authConstraints.length > 0
    ? `\n// Auth constraints:\n${authConstraints.map((a) => `//   - ${a}`).join('\n')}\n`
    : '';
  return `// ${e.method} ${e.path}
// request: ${e.requestShape}
// response: ${e.responseShape}
// notes: ${e.notes || '_(none)_'}${authBlock}

export interface Request {
  /* ${e.requestShape} */
}

export interface Response {
  /* ${e.responseShape} */
}

export async function handler(_req: Request): Promise<Response> {
  // TODO: implement per backend-architect spec.
  return {} as Response;
}
`;
}

function scaffoldService(name: string, notes: string): string {
  return `// Service: ${name}
// notes: ${notes || '_(none)_'}

export class ${name} {
  async execute(): Promise<void> {
    // TODO: implement per backend-architect spec.
  }
}
`;
}

function emitDatabaseFiles(brief: ImplementationBrief): readonly EmittedFile[] {
  const out: EmittedFile[] = [];
  for (const m of brief.database.migrations) {
    out.push({
      path: `migrations/${m.filename}`,
      contents: scaffoldMigration(m),
      attribution: ['database-architect'],
    });
  }
  for (const r of brief.database.repositories) {
    out.push({
      path: r.path,
      contents: `// Repository: ${r.repoName}\n// notes: ${r.notes || '_(none)_'}\n\nexport class ${r.repoName} {\n  // TODO: implement per database-architect spec.\n}\n`,
      attribution: ['database-architect'],
    });
  }
  return out;
}

function scaffoldMigration(m: MigrationSpec): string {
  return `-- ${m.filename}
-- notes: ${m.notes || '_(none)_'}

${m.sql}
`;
}

function emitTestFiles(brief: ImplementationBrief): readonly EmittedFile[] {
  if (brief.tests.cases.length === 0) return [];
  const out: EmittedFile[] = [];
  // Group cases by layer for a single file per layer.
  const byLayer = new Map<string, typeof brief.tests.cases>();
  for (const tc of brief.tests.cases) {
    const arr = byLayer.get(tc.layer);
    if (arr) {
      (arr as typeof brief.tests.cases & unknown[]).push(tc as never);
    } else {
      byLayer.set(tc.layer, [tc]);
    }
  }
  for (const [layer, cases] of byLayer) {
    const filePath = `tests/${layer}/${brief.ticketId.toLowerCase()}.test.ts`;
    const body = cases
      .map((c) => {
        const selectorComment = c.selectorHints.length > 0
          ? `    // selectors: ${c.selectorHints.map((s) => `\`${s}\``).join(', ')}\n`
          : '';
        return `  it('${escapeJs(c.id)} — ${escapeJs(c.title)}', () => {
${selectorComment}    // Given: ${escapeJs(c.given)}
    // When:  ${escapeJs(c.when)}
    // Then:  ${escapeJs(c.then)}
    expect(true).toBe(true); // TODO: implement against test-author spec.
  });`;
      })
      .join('\n\n');
    const contents = `import { describe, expect, it } from 'vitest';

describe('${brief.ticketId} — ${layer}', () => {
${body}
});
`;
    out.push({
      path: filePath,
      contents,
      attribution: ['test-author'],
    });
  }
  return out;
}

// ─── Envelope parsing ─────────────────────────────────────────────────────

/**
 * Extract the JSON file plan from the assistant's reply. The subagent
 * is instructed to emit `{ frontend, backend, database, tests }` either
 * as the entire reply or inside a fenced code block. We accept both.
 */
export function extractFilePlan(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  // First, try fenced code blocks (```json ... ```).
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1]);
    } catch {
      /* fall through */
    }
  }
  // Second, try the entire trimmed reply.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  // Third, try the first balanced-brace JSON object in the reply.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      /* fall through */
    }
  }
  return null;
}

export interface ValidatedFilePlan {
  ok: true;
  files: EmittedFiles;
}

export interface InvalidFilePlan {
  ok: false;
  diagnostic: string;
}

/** Validate the parsed file plan against the EmittedFiles shape. */
export function validateFilePlan(value: unknown): ValidatedFilePlan | InvalidFilePlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, diagnostic: 'file plan is not an object' };
  }
  const o = value as Record<string, unknown>;
  const required = ['frontend', 'backend', 'database', 'tests'] as const;
  for (const key of required) {
    if (!Array.isArray(o[key])) {
      return { ok: false, diagnostic: `missing or non-array bucket: ${key}` };
    }
  }
  const cast = (raw: unknown[]): EmittedFile[] => {
    const out: EmittedFile[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      if (typeof r['path'] !== 'string' || typeof r['contents'] !== 'string') continue;
      out.push({
        path: r['path'],
        contents: r['contents'],
        attribution: Array.isArray(r['attribution'])
          ? (r['attribution'] as unknown[]).filter((x): x is string => typeof x === 'string')
          : [],
      });
    }
    return out;
  };
  return {
    ok: true,
    files: {
      frontend: cast(o['frontend'] as unknown[]),
      backend: cast(o['backend'] as unknown[]),
      database: cast(o['database'] as unknown[]),
      tests: cast(o['tests'] as unknown[]),
    },
  };
}

// ─── Local helpers ────────────────────────────────────────────────────────

function pascalCase(s: string): string {
  return s
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/\s/g, '')
    .replace(/^(.)/, (_m, c: string) => c.toUpperCase());
}

function kebabCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[_\s/]+/g, '-')
    .toLowerCase();
}

function extractBaseName(path: string): string {
  const stripped = path.replace(/\.[^.]+$/, '');
  const last = stripped.split('/').pop() ?? stripped;
  return last;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeJs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
