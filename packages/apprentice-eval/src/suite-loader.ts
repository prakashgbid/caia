/**
 * suite-loader — reads YAML eval suites from `suiteRoot`.
 *
 * Per DESIGN.md §5 (suite YAML format). Promptfoo-shape subset:
 *
 *   description: '<suite-description>'
 *   defaultTest:
 *     vars: { ... }
 *     assert: [ ... ]
 *   tests:
 *     - description: '...'
 *       vars: { prompt: '...' }
 *       assert: [ ... ]
 */

import { load as parseYaml } from 'js-yaml';

import type {
  Assertion,
  FsReader,
  PromptSuite,
  SuiteDefaultTest,
  SuiteTestCase
} from './types.js';

const VALID_ASSERT_TYPES = new Set([
  'contains',
  'not-contains',
  'regex',
  'equals',
  'javascript',
  'semantic-similarity'
]);

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function parseAssertion(raw: unknown, ctx: string): Assertion {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`[apprentice-eval] ${ctx}: assertion must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const type = obj['type'];
  const value = obj['value'];
  if (typeof type !== 'string' || !VALID_ASSERT_TYPES.has(type)) {
    throw new Error(`[apprentice-eval] ${ctx}: invalid assertion type ${String(type)}`);
  }
  if (typeof value !== 'string') {
    throw new Error(`[apprentice-eval] ${ctx}: assertion.value must be a string`);
  }
  const weight = typeof obj['weight'] === 'number' ? (obj['weight'] as number) : undefined;
  if (type === 'semantic-similarity') {
    const threshold =
      typeof obj['threshold'] === 'number' ? (obj['threshold'] as number) : undefined;
    return { type, value, ...(threshold !== undefined ? { threshold } : {}), ...(weight !== undefined ? { weight } : {}) };
  }
  // The discriminated union narrows on `type`; build a typed object.
  switch (type) {
    case 'contains':
    case 'not-contains':
    case 'regex':
    case 'equals':
    case 'javascript':
      return { type, value, ...(weight !== undefined ? { weight } : {}) } as Assertion;
    /* c8 ignore next 2 */
    default:
      throw new Error(`[apprentice-eval] ${ctx}: unreachable assertion type`);
  }
}

function parseDefaultTest(raw: unknown, ctx: string): SuiteDefaultTest | undefined {
  if (!raw) return undefined;
  if (typeof raw !== 'object') {
    throw new Error(`[apprentice-eval] ${ctx}: defaultTest must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  let vars: Record<string, string> | undefined;
  let assertions: ReadonlyArray<Assertion> | undefined;
  if (obj['vars']) {
    if (typeof obj['vars'] !== 'object') {
      throw new Error(`[apprentice-eval] ${ctx}: defaultTest.vars must be an object`);
    }
    vars = { ...(obj['vars'] as Record<string, string>) };
  }
  if (obj['assert']) {
    if (!Array.isArray(obj['assert'])) {
      throw new Error(`[apprentice-eval] ${ctx}: defaultTest.assert must be an array`);
    }
    assertions = (obj['assert'] as unknown[]).map((a, i) =>
      parseAssertion(a, `${ctx}.defaultTest.assert[${i}]`)
    );
  }
  return {
    ...(vars ? { vars } : {}),
    ...(assertions ? { assert: assertions } : {})
  };
}

function parseTest(raw: unknown, ctx: string, idx: number): SuiteTestCase {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`[apprentice-eval] ${ctx}: tests[${idx}] must be an object`);
  }
  const obj = raw as Record<string, unknown>;
  const description = obj['description'];
  const vars = obj['vars'];
  const assertList = obj['assert'];
  if (typeof description !== 'string' || description.length === 0) {
    throw new Error(`[apprentice-eval] ${ctx}: tests[${idx}].description required`);
  }
  if (!vars || typeof vars !== 'object') {
    throw new Error(`[apprentice-eval] ${ctx}: tests[${idx}].vars must be an object`);
  }
  const varsObj = vars as Record<string, unknown>;
  if (typeof varsObj['prompt'] !== 'string') {
    throw new Error(`[apprentice-eval] ${ctx}: tests[${idx}].vars.prompt required`);
  }
  const stringVars: Record<string, string> = {};
  for (const [k, v] of Object.entries(varsObj)) {
    if (typeof v === 'string') stringVars[k] = v;
  }
  const assertions =
    assertList === undefined
      ? []
      : Array.isArray(assertList)
        ? (assertList as unknown[]).map((a, i) =>
            parseAssertion(a, `${ctx}.tests[${idx}].assert[${i}]`)
          )
        : (() => {
            throw new Error(`[apprentice-eval] ${ctx}: tests[${idx}].assert must be an array`);
          })();

  const id = typeof obj['id'] === 'string' ? (obj['id'] as string) : slugify(description);
  return {
    id,
    description,
    vars: { prompt: varsObj['prompt'] as string, ...stringVars },
    assert: assertions
  };
}

/**
 * Parse a single YAML buffer into a PromptSuite. Throws on schema errors.
 */
export function parseSuiteYaml(yaml: string, sourcePath: string, suiteId: string): PromptSuite {
  const raw = parseYaml(yaml);
  if (!raw || typeof raw !== 'object') {
    throw new Error(`[apprentice-eval] ${sourcePath}: top-level must be a mapping`);
  }
  const obj = raw as Record<string, unknown>;
  const description = obj['description'];
  if (typeof description !== 'string') {
    throw new Error(`[apprentice-eval] ${sourcePath}: description required (string)`);
  }
  const tests = obj['tests'];
  if (!Array.isArray(tests) || tests.length === 0) {
    throw new Error(`[apprentice-eval] ${sourcePath}: tests must be a non-empty array`);
  }
  const defaultTest = parseDefaultTest(obj['defaultTest'], sourcePath);
  const parsedTests = (tests as unknown[]).map((t, i) => parseTest(t, sourcePath, i));

  // Enforce id uniqueness within a suite.
  const seen = new Set<string>();
  for (const t of parsedTests) {
    if (seen.has(t.id!)) {
      throw new Error(`[apprentice-eval] ${sourcePath}: duplicate test id ${t.id}`);
    }
    seen.add(t.id!);
  }

  return {
    id: suiteId,
    description,
    ...(defaultTest ? { defaultTest } : {}),
    tests: parsedTests,
    sourcePath
  };
}

export interface LoadSuitesOpts {
  readonly suiteRoot: string;
  readonly fs: FsReader;
  /** Restrict to ids; null = all. */
  readonly only?: ReadonlyArray<string> | null;
}

export async function loadSuites(opts: LoadSuitesOpts): Promise<PromptSuite[]> {
  if (!(await opts.fs.exists(opts.suiteRoot))) {
    throw new Error(`[apprentice-eval] suiteRoot not found: ${opts.suiteRoot}`);
  }
  const files = (await opts.fs.readDir(opts.suiteRoot))
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .filter((f) => !f.startsWith('_'))
    .sort();

  const suites: PromptSuite[] = [];
  for (const file of files) {
    const suiteId = file.replace(/\.ya?ml$/, '');
    if (opts.only && !opts.only.includes(suiteId)) continue;
    const path = `${opts.suiteRoot}/${file}`;
    const text = await opts.fs.readFile(path);
    suites.push(parseSuiteYaml(text, path, suiteId));
  }
  return suites;
}

/**
 * Apply defaultTest overlays into each test (merge vars + concat assertions).
 * After this pass the consumer can ignore `defaultTest`.
 */
export function applyDefaults(suite: PromptSuite): PromptSuite {
  const def = suite.defaultTest;
  if (!def) return suite;
  const tests = suite.tests.map((t) => ({
    ...t,
    vars: { ...(def.vars ?? {}), ...t.vars },
    assert: [...(def.assert ?? []), ...t.assert]
  }));
  return { ...suite, tests };
}
