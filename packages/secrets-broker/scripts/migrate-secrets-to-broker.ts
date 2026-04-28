#!/usr/bin/env node
/**
 * migrate-secrets-to-broker.ts
 *
 * 1. Scans all site repos for .env.production / .env.local with non-public secrets
 * 2. Lists what would be moved into vault (dry-run by default)
 * 3. Checks git history for accidentally committed secrets
 * 4. Files BL-SECRETS-COMMITTED-<sha>.md for each detected committed secret
 * 5. Files BL-GA4-MIGRATE-TO-BROKER.md after GA4 task lands (if not already filed)
 *
 * Usage:
 *   npx ts-node scripts/migrate-secrets-to-broker.ts [--execute] [--repos-dir /path/to/repos]
 */
import { readdirSync, readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { homedir } from 'node:os';

interface EnvVar {
  key: string;
  isPublic: boolean;
  envFile: string;
  siteSlug: string;
  repoPath: string;
}

interface CommittedSecret {
  key: string;
  commitSha: string;
  filePath: string;
  siteSlug: string;
}

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const REPOS_DIR = (() => {
  const i = args.indexOf('--repos-dir');
  return i >= 0 ? resolve(args[i + 1]!) : resolve(process.cwd(), '..');
})();
const BLOCKERS_DIR = join(REPOS_DIR, 'blockers');
const ENV_FILES = ['.env.production', '.env.local', '.env'];

function isSiteRepo(dir: string): boolean {
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'next.config.js') || join(dir, 'next.config.ts') || join(dir, 'wrangler.toml'));
}

function detectSiteSlug(dir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name?: string };
    return pkg.name?.replace(/^@[^/]+\//, '').replace(/\//g, '-') ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function scanEnvFile(repoPath: string, envFile: string, siteSlug: string): EnvVar[] {
  const fullPath = join(repoPath, envFile);
  if (!existsSync(fullPath)) return [];
  const lines = readFileSync(fullPath, 'utf8').split('\n');
  const results: EnvVar[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!key) continue;
    results.push({
      key,
      isPublic: key.startsWith('NEXT_PUBLIC_'),
      envFile,
      siteSlug,
      repoPath,
    });
  }
  return results;
}

function checkGitHistory(repoPath: string, envFile: string, siteSlug: string): CommittedSecret[] {
  const committed: CommittedSecret[] = [];
  try {
    const result = execSync(
      `git -C "${repoPath}" log --all --oneline -- "${envFile}" 2>/dev/null`,
      { encoding: 'utf8', timeout: 10_000 },
    ).trim();
    if (!result) return [];

    // Get all commits that touched this env file
    const commits = result.split('\n').map(l => l.split(' ')[0]!).filter(Boolean);
    for (const sha of commits.slice(0, 5)) {
      try {
        const diff = execSync(
          `git -C "${repoPath}" show "${sha}:${envFile}" 2>/dev/null`,
          { encoding: 'utf8', timeout: 5_000 },
        );
        const lines = diff.split('\n');
        for (const line of lines) {
          const eqIdx = line.indexOf('=');
          if (eqIdx < 0) continue;
          const key = line.slice(0, eqIdx).trim();
          const value = line.slice(eqIdx + 1).trim();
          if (!key.startsWith('#') && key && value && value !== 'your_value_here' && !key.startsWith('NEXT_PUBLIC_')) {
            committed.push({ key, commitSha: sha, filePath: envFile, siteSlug });
          }
        }
      } catch {
        // File didn't exist in that commit
      }
    }
  } catch {
    // Not a git repo or git not available
  }
  return committed;
}

function fileBlocker(name: string, content: string): void {
  mkdirSync(BLOCKERS_DIR, { recursive: true });
  const path = join(BLOCKERS_DIR, `${name}.md`);
  if (!existsSync(path)) {
    writeFileSync(path, content, 'utf8');
    console.log(`  📋 Filed blocker: ${name}.md`);
  } else {
    console.log(`  ⏭  Blocker already exists: ${name}.md`);
  }
}

function main(): void {
  console.log(`\n🔍 Secrets Migration Scanner`);
  console.log(`   Repos dir: ${REPOS_DIR}`);
  console.log(`   Mode: ${EXECUTE ? 'EXECUTE (will move secrets)' : 'DRY RUN (no changes)'}\n`);

  const siteRepos: string[] = [];
  try {
    for (const entry of readdirSync(REPOS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(REPOS_DIR, entry.name);
      if (isSiteRepo(full)) siteRepos.push(full);
    }
  } catch (err) {
    console.error(`❌ Cannot read repos dir: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  if (!siteRepos.length) {
    console.log('No site repos found. Check --repos-dir or run from the projects directory.');
    return;
  }

  console.log(`Found ${siteRepos.length} site repo(s):\n`);

  const allVars: EnvVar[] = [];
  const allCommitted: CommittedSecret[] = [];

  for (const repoPath of siteRepos) {
    const siteSlug = detectSiteSlug(repoPath);
    console.log(`  📁 ${siteSlug} (${repoPath})`);

    for (const envFile of ENV_FILES) {
      const vars = scanEnvFile(repoPath, envFile, siteSlug);
      if (vars.length) {
        const priv = vars.filter(v => !v.isPublic);
        const pub = vars.filter(v => v.isPublic);
        console.log(`    ${envFile}: ${priv.length} private, ${pub.length} public`);
        for (const v of vars) {
          const tag = v.isPublic ? '[public]' : '[PRIVATE → move to vault]';
          console.log(`      ${v.key}  ${tag}`);
        }
        allVars.push(...vars);
      }

      const committed = checkGitHistory(repoPath, envFile, siteSlug);
      if (committed.length) {
        console.log(`    ⚠️  Git history: ${committed.length} non-public vars found in commits!`);
        allCommitted.push(...committed);
      }
    }
    console.log();
  }

  // Summary
  const privateVars = allVars.filter(v => !v.isPublic);
  const publicVars = allVars.filter(v => v.isPublic);

  console.log('─'.repeat(60));
  console.log(`\n📊 Summary`);
  console.log(`  Private secrets to migrate: ${privateVars.length}`);
  console.log(`  Public vars (keep in env):  ${publicVars.length}`);
  console.log(`  Committed secrets detected: ${allCommitted.length}`);

  // File blockers for committed secrets
  for (const cs of allCommitted) {
    const name = `BL-SECRETS-COMMITTED-${cs.commitSha.slice(0, 8)}`;
    fileBlocker(name, `# Blocker: ${name}

**Severity:** HIGH
**Created:** ${new Date().toISOString()}

## Issue

Secret key \`${cs.key}\` for site \`${cs.siteSlug}\` was found in git history:

- **Commit SHA:** \`${cs.commitSha}\`
- **File:** \`${cs.filePath}\`

## Required Actions

1. **Rotate \`${cs.key}\`** immediately — assume it is compromised.
   \`\`\`
   secrets rotate ${cs.key} --site ${cs.siteSlug}
   \`\`\`
2. Consider removing the commit from history if the repo is private:
   \`\`\`
   git filter-branch --force --index-filter 'git rm --cached --ignore-unmatch ${cs.filePath}' --prune-empty --tag-name-filter cat -- --all
   \`\`\`
3. Verify the secret has been rotated in all deployment environments.
4. Close this blocker after rotation is confirmed.

## Context

Detected by \`migrate-secrets-to-broker.ts\` on ${new Date().toISOString()}.
`);
  }

  // File GA4 migration blocker if GA4 vars found in .env files
  const ga4Vars = allVars.filter(v => v.key.includes('GA4') || v.key.includes('MEASUREMENT'));
  if (ga4Vars.length > 0) {
    fileBlocker('BL-GA4-MIGRATE-TO-BROKER', `# Blocker: BL-GA4-MIGRATE-TO-BROKER

**Severity:** LOW
**Priority:** After GA4 activation task completes
**Created:** ${new Date().toISOString()}

## Goal

Move GA4 Measurement IDs from \`.env.production\` into the secrets broker vault.
They are public identifiers (ship in page HTML) but the broker handles them for consistency.

## Affected Sites

${ga4Vars.map(v => `- \`${v.siteSlug}\`: \`${v.key}\` in \`${v.envFile}\``).join('\n')}

## Migration Steps

1. Add each site's manifest to \`~/.broker-manifests/<site>.json\`:
   \`\`\`json
   {
     "site_slug": "<site>",
     "secrets": {
       "NEXT_PUBLIC_GA4_MEASUREMENT_ID": {
         "path": "kv/ga4/<site>",
         "public": true,
         "ttl_sec": 3600
       }
     }
   }
   \`\`\`
2. Load the values into vault:
   \`\`\`bash
   secrets rotate NEXT_PUBLIC_GA4_MEASUREMENT_ID --site <site> --value G-XXXXXXXXXX
   \`\`\`
3. Rewrite deploy scripts to use:
   \`\`\`bash
   eval \$(secrets fetch-env <site>)
   \`\`\`
4. Remove \`NEXT_PUBLIC_GA4_MEASUREMENT_ID\` from \`.env.production\`.

## Notes

- GA4 IDs marked \`public: true\` — broker will NOT redact them in logs.
- Do NOT interrupt the running GA4 activation task before migrating.
`);
  }

  if (EXECUTE && privateVars.length > 0) {
    console.log('\n⚡ EXECUTE mode: vault population skipped — run individual `secrets rotate` commands.');
    console.log('   Suggested commands:');
    for (const v of privateVars) {
      console.log(`     secrets rotate ${v.key} --site ${v.siteSlug} --value <your_value>`);
    }
  }

  if (!EXECUTE) {
    console.log('\n💡 Run with --execute to apply changes (rotation still requires --value per key).');
  }

  console.log('\n✅ Scan complete.\n');
}

main();
