import type { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface DoctorCheck {
  name: string;
  pass: boolean;
  message: string;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Audit a CAIA consumer repo for compliance')
    .option('--repo <path>', 'Path to repo to audit', '.')
    .action((opts: { repo: string }) => {
      const checks = runChecks(resolve(opts.repo));
      const failed = checks.filter((c) => !c.pass);

      checks.forEach((c) => {
        console.log(`${c.pass ? '✅' : '❌'} ${c.name}: ${c.message}`);
      });

      if (failed.length > 0) {
        console.log(`\n${failed.length} check(s) failed.`);
        process.exit(1);
      } else {
        console.log('\nAll checks passed.');
      }
    });
}

function runChecks(repoPath: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];

  // Check pnpm-workspace.yaml exists
  checks.push({
    name: 'pnpm workspace',
    pass: existsSync(resolve(repoPath, 'pnpm-workspace.yaml')),
    message: existsSync(resolve(repoPath, 'pnpm-workspace.yaml'))
      ? 'Found pnpm-workspace.yaml'
      : 'Missing pnpm-workspace.yaml — run: caia init',
  });

  // Check turbo.json exists
  checks.push({
    name: 'Turborepo',
    pass: existsSync(resolve(repoPath, 'turbo.json')),
    message: existsSync(resolve(repoPath, 'turbo.json'))
      ? 'Found turbo.json'
      : 'Missing turbo.json — run: caia init',
  });

  // Check .changeset dir
  checks.push({
    name: 'Changesets',
    pass: existsSync(resolve(repoPath, '.changeset', 'config.json')),
    message: existsSync(resolve(repoPath, '.changeset', 'config.json'))
      ? 'Changesets configured'
      : 'Missing .changeset/config.json — run: pnpm changeset init',
  });

  // Check packages use @chiefaia scope
  const pkgPath = resolve(repoPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string };
      const scopeOk = !pkg.name || pkg.name.startsWith('@chiefaia/') || pkg.name === 'caia';
      checks.push({
        name: 'npm scope',
        pass: scopeOk,
        message: scopeOk ? 'Using @chiefaia scope' : `Package name '${pkg.name}' should use @chiefaia scope`,
      });
    } catch {
      checks.push({ name: 'npm scope', pass: false, message: 'Could not parse package.json' });
    }
  }

  return checks;
}
