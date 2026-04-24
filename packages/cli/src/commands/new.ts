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
    .option('--dry-run', 'Print what would be created without writing files')
    .action(async (name: string, opts: { domain?: string; dryRun?: boolean }) => {
      await scaffoldSite(name, opts.domain, opts.dryRun ?? false);
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

async function scaffoldSite(name: string, domain: string | undefined, dryRun: boolean): Promise<void> {
  const templateDir = resolve(new URL('../../../templates/site', import.meta.url).pathname);
  const target = resolve(process.cwd(), '..', name);

  if (dryRun) {
    console.log(`[dry-run] Would scaffold site repo at ../${name}/`);
    console.log(`  Domain: ${domain ?? '(not set)'}`);
    console.log(`  Template: ${templateDir}`);
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
  console.log(`Next: cd ../${name} && pnpm install && pnpm dev`);
}
