#!/usr/bin/env node
/**
 * caia-architect-new — scaffold a new specialist-architect package.
 *
 * Sourced from research/17_architect_framework_spec_2026.md §8.
 *
 * Usage:
 *   pnpm caia-architect-new \
 *     --name analytics \
 *     --depends-on frontend \
 *     --precedence 10 \
 *     --writes "analytics.provider,analytics.eventTaxonomy" \
 *     --runtime-model sonnet
 *
 * Creates packages/<name>-architect/ with a working stub: contract + class
 * extending BaseArchitect + tests that pass on a fresh scaffold.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

function printHelp() {
  process.stdout.write(
    [
      'Usage: caia-architect-new --name <name> --writes <comma-paths> [options]',
      '',
      'Required:',
      '  --name <name>           Architect role name (e.g. analytics).',
      '  --writes <paths>        Comma-separated JSON paths the architect owns.',
      '',
      'Options:',
      '  --depends-on <names>    Comma-separated architect names. Default: empty.',
      '  --precedence <int>      Precedence rank (1..N). Default: 99 (low).',
      '  --runtime-model <m>     haiku|sonnet|opus. Default: sonnet.',
      '  --fanout <policy>       always|conditional|gated. Default: always.',
      '  --out-dir <dir>         Output directory. Default: ./packages.',
      '  --dry-run               Print planned files without writing.',
      '  --help                  Show this help.',
      '',
    ].join('\n'),
  );
}

function pascalCase(s) {
  return s
    .split(/[-_\s]+/)
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
}

function packageJson(name) {
  return (
    JSON.stringify(
      {
        name: `@caia/${name}-architect`,
        version: '0.1.0',
        private: true,
        description: `${name} specialist architect — populates the ${name}.* slice of tickets.architecture during the EA fan-out phase.`,
        main: 'src/index.ts',
        types: 'src/index.ts',
        scripts: {
          test: 'vitest run',
          typecheck: 'tsc --noEmit',
        },
        dependencies: {
          '@caia/architect-kit': 'workspace:*',
        },
        devDependencies: {
          '@types/node': '^20',
          typescript: '^5.4.5',
          vitest: '^1.6.0',
        },
      },
      null,
      2,
    ) + '\n'
  );
}

function tsconfig() {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          esModuleInterop: true,
          strict: true,
          exactOptionalPropertyTypes: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          noEmit: true,
          lib: ['ES2022'],
        },
        include: ['src/**/*', 'tests/**/*'],
      },
      null,
      2,
    ) + '\n'
  );
}

function vitestConfig() {
  return [
    "import { defineConfig } from 'vitest/config';",
    '',
    'export default defineConfig({',
    "  test: { include: ['tests/**/*.test.ts', 'src/**/*.test.ts'] },",
    '});',
    '',
  ].join('\n');
}

function readme(name, opts) {
  return [
    `# @caia/${name}-architect`,
    '',
    `Specialist architect for the **${name}** slice of \`tickets.architecture\`.`,
    '',
    `Owned JSON paths: ${opts.writes.map((w) => '`' + w + '`').join(', ')}.`,
    `Depends on: ${opts.dependsOn.length === 0 ? '_(no upstream architects)_' : opts.dependsOn.join(', ')}.`,
    `Precedence: ${opts.precedence}.`,
    `Runtime model: ${opts.runtimeModel}.`,
    `Fan-out policy: ${opts.fanoutPolicy}.`,
    '',
    '## How to run',
    '',
    'Spawned by `@caia/ea-dispatcher` during the EA fan-out phase. Not invoked directly.',
    '',
    '## Contract',
    '',
    'See [`src/contract.ts`](./src/contract.ts) for the section contract declaration.',
    '',
  ].join('\n');
}

function contractTs(name, opts) {
  const className = pascalCase(name);
  return [
    "import type { ArchitectSectionContract } from '@caia/architect-kit';",
    '',
    `export const ${className}Contract: ArchitectSectionContract = {`,
    `  contractId: '${name}-architect.v1',`,
    `  architectName: '${name}',`,
    `  version: '0.1.0',`,
    `  sections: [`,
    ...opts.writes.map(
      (p) =>
        `    { path: '${p}', description: 'TODO: describe the ${p} field', required: true },`,
    ),
    `  ],`,
    `  architectMeta: {`,
    `    dependsOn: ${JSON.stringify(opts.dependsOn)},`,
    `    precedenceLevel: ${opts.precedence},`,
    `    fanoutPolicy: '${opts.fanoutPolicy}',`,
    `    appliesPredicate: () => true,`,
    `    runtimeModel: '${opts.runtimeModel}',`,
    `  },`,
    `};`,
    '',
  ].join('\n');
}

function architectTs(name) {
  const className = pascalCase(name);
  return [
    "import { BaseArchitect } from '@caia/architect-kit';",
    "import type { ArchitectInput, ArchitectOutput } from '@caia/architect-kit';",
    `import { ${className}Contract } from './contract.js';`,
    '',
    `export class ${className}Architect extends BaseArchitect {`,
    `  readonly name = '${name}';`,
    `  readonly sectionContract = ${className}Contract;`,
    '',
    `  async run(input: ArchitectInput): Promise<ArchitectOutput> {`,
    `    void input;`,
    `    return this.partialOutput({}, {`,
    `      confidence: 0,`,
    `      notes: 'stub ${name} architect — replace run() with the real implementation',`,
    `      spend: this.zeroSpend('${name}-stub'),`,
    `    });`,
    `  }`,
    `}`,
    '',
  ].join('\n');
}

function indexTs(name) {
  const className = pascalCase(name);
  return [
    `export { ${className}Architect } from './architect.js';`,
    `export { ${className}Contract } from './contract.js';`,
    '',
  ].join('\n');
}

function contractTest(name) {
  const className = pascalCase(name);
  return [
    "import { describe, it, expect } from 'vitest';",
    `import { ${className}Contract } from '../src/contract.js';`,
    "import { contractPaths } from '@caia/architect-kit';",
    '',
    `describe('${className}Contract', () => {`,
    `  it('declares at least one section', () => {`,
    `    expect(contractPaths(${className}Contract).length).toBeGreaterThan(0);`,
    `  });`,
    `  it('declares unique section paths', () => {`,
    `    const paths = contractPaths(${className}Contract);`,
    `    expect(new Set(paths).size).toBe(paths.length);`,
    `  });`,
    `  it('has architectName matching contract id prefix', () => {`,
    `    expect(${className}Contract.architectName).toBe('${name}');`,
    `  });`,
    `});`,
    '',
  ].join('\n');
}

function architectTest(name) {
  const className = pascalCase(name);
  return [
    "import { describe, it, expect } from 'vitest';",
    `import { ${className}Architect } from '../src/architect.js';`,
    "import type { ArchitectInput } from '@caia/architect-kit';",
    '',
    'function stubInput(): ArchitectInput {',
    '  return {',
    "    ticket: { id: 't1', type: 'Page' },",
    '    upstream: { outputs: {} },',
    "    businessPlan: { ventureName: 'Test', oneLiner: 'x', audience: 'y', goals: [] },",
    "    designVersion: { versionId: 'v1', anchors: [] },",
    '    tenantContext: {',
    "      tenantId: 'tnt-1',",
    "      schemaName: 's1',",
    "      vaultNamespace: 'ns1',",
    "      billingPosture: 'subscription',",
    '      creditBalance: { usdAvailable: 100 },',
    '    },',
    '    budget: {',
    '      maxInputTokens: 60_000,',
    '      maxOutputTokens: 8_000,',
    '      maxWallClockMs: 60_000,',
    "      preferredModel: 'sonnet',",
    '      hardCostCeilingUsd: 1,',
    '    },',
    '  };',
    '}',
    '',
    `describe('${className}Architect', () => {`,
    `  it('returns an output keyed by the architect name', async () => {`,
    `    const a = new ${className}Architect();`,
    `    const out = await a.run(stubInput());`,
    `    expect(out.architectName).toBe('${name}');`,
    `  });`,
    `});`,
    '',
  ].join('\n');
}

function systemPromptMd(name, opts) {
  return [
    `# ${name} architect — system prompt`,
    '',
    `You are the ${name} specialist architect for the CAIA EA fan-out phase.`,
    '',
    `Your job is to populate the following JSON paths under tickets.architecture:`,
    ...opts.writes.map((p) => `  - \`${p}\``),
    '',
    'Return ONLY valid JSON. Do not add keys outside the contract. Do not omit',
    'required keys. Be concise — every byte costs.',
    '',
  ].join('\n');
}

export function scaffold(args) {
  const name = args.name;
  if (!name || typeof name !== 'string') {
    throw new Error('missing required --name argument');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(
      `--name '${name}' must be kebab-case alphanum (e.g. 'analytics', 'api-gateway')`,
    );
  }
  if (!args.writes || typeof args.writes !== 'string') {
    throw new Error('missing required --writes argument (comma-separated paths)');
  }

  const opts = {
    writes: args.writes.split(',').map((s) => s.trim()).filter(Boolean),
    dependsOn:
      typeof args['depends-on'] === 'string'
        ? args['depends-on'].split(',').map((s) => s.trim()).filter(Boolean)
        : [],
    precedence: Number.isFinite(Number(args.precedence)) ? Number(args.precedence) : 99,
    runtimeModel: ['haiku', 'sonnet', 'opus'].includes(args['runtime-model'])
      ? args['runtime-model']
      : 'sonnet',
    fanoutPolicy: ['always', 'conditional', 'gated'].includes(args.fanout)
      ? args.fanout
      : 'always',
  };

  const outDir = args['out-dir'] ?? './packages';
  const pkgDir = resolve(outDir, `${name}-architect`);

  const files = [
    { rel: 'package.json', content: packageJson(name) },
    { rel: 'tsconfig.json', content: tsconfig() },
    { rel: 'vitest.config.ts', content: vitestConfig() },
    { rel: 'README.md', content: readme(name, opts) },
    { rel: 'src/index.ts', content: indexTs(name) },
    { rel: 'src/contract.ts', content: contractTs(name, opts) },
    { rel: 'src/architect.ts', content: architectTs(name) },
    { rel: 'src/system-prompt.md', content: systemPromptMd(name, opts) },
    { rel: 'tests/contract.test.ts', content: contractTest(name) },
    { rel: 'tests/architect.test.ts', content: architectTest(name) },
  ];

  if (args['dry-run']) {
    process.stdout.write(`[caia-architect-new] (dry-run) would create ${pkgDir} with:\n`);
    for (const f of files) {
      process.stdout.write(`  - ${f.rel} (${f.content.length} bytes)\n`);
    }
    return { dryRun: true, pkgDir, files };
  }

  if (existsSync(pkgDir)) {
    throw new Error(`package dir already exists: ${pkgDir}`);
  }

  for (const f of files) {
    const abs = join(pkgDir, f.rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, f.content, 'utf8');
  }
  return { dryRun: false, pkgDir, files };
}

const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  (typeof process.argv[1] === 'string' &&
    import.meta.url.endsWith(process.argv[1].split('/').pop() ?? ''));

if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  try {
    const result = scaffold(args);
    if (result.dryRun) process.exit(0);
    process.stdout.write(`[caia-architect-new] scaffolded ${result.pkgDir}\n`);
    for (const f of result.files) {
      process.stdout.write(`  + ${f.rel}\n`);
    }
  } catch (err) {
    process.stderr.write(`[caia-architect-new] ${err.message}\n`);
    process.exit(1);
  }
}

void SCRIPT_DIR;
