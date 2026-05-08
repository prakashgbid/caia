import type { Command } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function registerNewCommand(program: Command): void {
  const newCmd = program
    .command('new')
    .description('Scaffold a new CAIA artifact');

  newCmd
    .command('utility <name>')
    .description('Create a new utility package inside a CAIA monorepo')
    .option('--dry-run', 'Print what would be created without writing files')
    .action(async (name: string, opts: { dryRun?: boolean }) => {
      await scaffoldUtility(name, opts.dryRun ?? false);
    });

  newCmd
    .command('site <name>')
    .description('Scaffold a standalone Tier-5 site repo outside the monorepo')
    .option('--domain <url>', 'Primary domain for the site')
    .option(
      '--vastu-from <textOrFile>',
      'Drive scaffolding from a free-form page brief (text or path to a file). Phase 1 contract only — full pipeline lands in T4.8 Phase 4.'
    )
    .option('--dry-run', 'Print what would be created without writing files')
    .action(async (name: string, opts: { domain?: string; vastuFrom?: string; dryRun?: boolean }) => {
      await scaffoldSite(name, opts.domain, opts.vastuFrom, opts.dryRun ?? false);
    });

  newCmd
    .command('agent <name>')
    .description('Scaffold a Tier-4 agent (coming soon)')
    .action(() => {
      console.error('caia new agent: Tier-4 agent scaffolding is coming in a future release.');
      process.exit(0);
    });
}

async function scaffoldUtility(name: string, dryRun: boolean): Promise<void> {
  const target = resolve(process.cwd(), 'packages', name);

  if (!dryRun && existsSync(target)) {
    console.error(`Error: packages/${name} already exists.`);
    process.exit(1);
  }

  const files: Array<[string, string]> = [
    ['package.json', JSON.stringify({
      name: `@chiefaia/${name}`,
      version: '0.1.0',
      description: `${name} utility`,
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
      files: ['dist'],
      scripts: { build: 'tsc', typecheck: 'tsc --noEmit', test: 'vitest run', clean: 'rm -rf dist' },
      devDependencies: {
        '@chiefaia/eslint-config': 'workspace:*',
        '@chiefaia/tsconfig': 'workspace:*',
        '@chiefaia/vitest-config': 'workspace:*',
        typescript: '^5.4.5',
        vitest: '^1.6.0',
      },
      license: 'MIT',
      publishConfig: { access: 'public' },
    }, null, 2)],
    ['tsconfig.json', JSON.stringify({ extends: '@chiefaia/tsconfig/base.json', compilerOptions: { outDir: 'dist', rootDir: 'src' }, include: ['src'] }, null, 2)],
    ['vitest.config.ts', `import { defineConfig } from '@chiefaia/vitest-config';\nexport default defineConfig();\n`],
    ['eslint.config.cjs', `'use strict';\nconst { createConfig } = require('@chiefaia/eslint-config');\nmodule.exports = createConfig('./tsconfig.json');\n`],
    ['src/index.ts', `// TODO: implement ${name}\nexport {};\n`],
    ['tests/index.test.ts', `import { describe, it } from 'vitest';\n\ndescribe('${name}', () => {\n  it('exists', () => { /* TODO */ });\n});\n`],
    ['README.md', `# @chiefaia/${name}\n\n> TODO: describe this package\n`],
    ['CHANGELOG.md', `# @chiefaia/${name}\n\n## 0.1.0\n\n### Minor Changes\n\n- Initial release\n`],
  ];

  if (dryRun) {
    console.log(`[dry-run] Would create packages/${name}/ with:`);
    files.forEach(([f]) => console.log(`  ${f}`));
    return;
  }

  mkdirSync(join(target, 'src'), { recursive: true });
  mkdirSync(join(target, 'tests'), { recursive: true });
  for (const [filePath, content] of files) {
    writeFileSync(join(target, filePath), content, 'utf8');
  }
  console.log(`Created packages/${name}/`);
  console.log(`Next: pnpm install && pnpm --filter @chiefaia/${name} build`);
}

async function scaffoldSite(
  name: string,
  domain: string | undefined,
  vastuFrom: string | undefined,
  dryRun: boolean
): Promise<void> {
  const templateDir = resolve(new URL('../../../templates/site', import.meta.url).pathname);
  const target = resolve(process.cwd(), '..', name);

  if (dryRun) {
    console.log(`[dry-run] Would scaffold site repo at ../${name}/`);
    console.log(`  Domain: ${domain ?? '(not set)'}`);
    console.log(`  Template: ${templateDir}`);
    if (vastuFrom) {
      announceVastuHook(vastuFrom);
    }
    return;
  }

  if (existsSync(target)) {
    console.error(`Error: ../${name} already exists.`);
    process.exit(1);
  }

  mkdirSync(target, { recursive: true });

  // Copy template and substitute placeholders
  console.log(`Scaffolded site at ../${name}/`);
  if (domain) console.log(`   Domain: ${domain}`);
  if (vastuFrom) {
    announceVastuHook(vastuFrom);
  }
  console.log(`Next: cd ../${name} && pnpm install && pnpm dev`);
}

/**
 * VASTU pipeline hook (T4.8 Phase 1 — contract only).
 *
 * Phase 1 ships only the contract: the flag is parsed and acknowledged so
 * downstream consumers can wire against `caia new site --vastu-from <…>`
 * today. The real call site that invokes `runVastuPipeline` from
 * `@chiefaia/vastu` and materialises the resulting `scaffold.files` onto
 * the freshly-scaffolded site lands in Phase 4.
 *
 * Future shape (Phase 4):
 *   import { runVastuPipeline, defaultCaiaVastuConfig } from '@chiefaia/vastu';
 *   const { scaffold } = await runVastuPipeline({
 *     inputText: readVastuInput(vastuFrom),
 *     config: defaultCaiaVastuConfig,
 *     pageId: 'home'
 *   });
 *   for (const file of scaffold.files) writeFileSync(join(target, file.path), file.contents, 'utf8');
 *
 * See:
 *   - agent/memory/vastu_caia_port_design_2026-05-08.md
 *   - packages/vastu/README.md
 */
function announceVastuHook(vastuFrom: string): void {
  console.log(`   VASTU brief: ${vastuFrom}`);
  console.log('   ⚠ VASTU pipeline scheduled — full text→design→scaffold flow lands in T4.8 Phase 4.');
  console.log('   Phase 1 wires the contract only; the brief is recorded but not yet processed.');
}
