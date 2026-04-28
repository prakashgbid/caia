#!/usr/bin/env node
/**
 * Secrets Broker CLI
 *
 * Usage:
 *   secrets fetch <key> [--site <slug>] [--caller <module>]
 *   secrets fetch-env <site>
 *   secrets list [--site <slug>]
 *   secrets rotate <key> [--site <slug>]
 *   secrets audit [--limit <n>]
 */
import { Command } from 'commander';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fetchSecret, fetchEnv, rotateSecret, loadManifest } from './client.js';
import { getAuditLog } from './events.js';
import type { SiteManifest } from './types.js';

const MANIFEST_DIR = process.env['BROKER_MANIFEST_DIR'] ?? join(homedir(), '.broker-manifests');

function loadManifestsFromDir(): void {
  if (!existsSync(MANIFEST_DIR)) return;
  for (const f of readdirSync(MANIFEST_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const manifest = JSON.parse(readFileSync(join(MANIFEST_DIR, f), 'utf8')) as SiteManifest;
      loadManifest(manifest);
    } catch {
      // Ignore malformed manifests
    }
  }
}

const program = new Command();
program.name('secrets').description('Secrets broker CLI').version('0.1.0');

program
  .command('fetch <key>')
  .description('Fetch a single secret and print its value to stdout')
  .option('-s, --site <slug>', 'Site slug', 'default')
  .option('-c, --caller <module>', 'Caller module name', 'cli')
  .action(async (key: string, opts: { site: string; caller: string }) => {
    loadManifestsFromDir();
    const result = await fetchSecret(key, { siteSlug: opts.site, callerModule: opts.caller });
    process.stdout.write(result.value + '\n');
  });

program
  .command('fetch-env <site>')
  .description('Fetch all secrets for a site, print as KEY=value lines (eval-safe)')
  .option('-c, --caller <module>', 'Caller module name', 'deploy-script')
  .action(async (site: string, opts: { caller: string }) => {
    loadManifestsFromDir();
    const env = await fetchEnv(site, { callerModule: opts.caller });
    for (const [k, v] of Object.entries(env)) {
      process.stdout.write(`${k}=${v}\n`);
    }
  });

program
  .command('list')
  .description('List secret key names for a site (never prints values)')
  .option('-s, --site <slug>', 'Site slug', 'default')
  .action((opts: { site: string }) => {
    loadManifestsFromDir();
    const { _manifests: _ } = (() => {
      // Access via dynamic import not available in CJS — re-read manifest dir
      if (!existsSync(MANIFEST_DIR)) {
        console.log('No manifests found. Set BROKER_MANIFEST_DIR or load manifests first.');
        return { _manifests: null };
      }
      return { _manifests: null };
    })();

    const files = existsSync(MANIFEST_DIR) ? readdirSync(MANIFEST_DIR).filter(f => f.endsWith('.json')) : [];
    for (const f of files) {
      try {
        const manifest = JSON.parse(readFileSync(join(MANIFEST_DIR, f), 'utf8')) as SiteManifest;
        if (opts.site === 'default' || manifest.site_slug === opts.site) {
          console.log(`\nSite: ${manifest.site_slug}`);
          for (const [key, meta] of Object.entries(manifest.secrets)) {
            const pub = meta.public ? ' [public]' : ' [private]';
            console.log(`  ${key}${pub}  ttl=${meta.ttl_sec}s`);
          }
        }
      } catch {
        // Skip malformed
      }
    }
  });

program
  .command('rotate <key>')
  .description('Rotate a secret: writes new value to vault, invalidates cache, flags re-deploy')
  .option('-s, --site <slug>', 'Site slug', 'default')
  .option('-c, --caller <module>', 'Caller module name', 'cli')
  .option('-v, --value <newValue>', 'New value (if not provided, reads from stdin)')
  .action(async (key: string, opts: { site: string; caller: string; value?: string }) => {
    loadManifestsFromDir();
    let newValue = opts.value;
    if (!newValue) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      newValue = Buffer.concat(chunks).toString('utf8').trim();
    }
    if (!newValue) {
      console.error('❌ No new value provided (use --value or pipe via stdin)');
      process.exit(1);
    }
    await rotateSecret(key, newValue, { siteSlug: opts.site, callerModule: opts.caller });
    console.log(`✅ Rotated ${key} for site ${opts.site}. Re-deploy required to pick up new value.`);
  });

program
  .command('audit')
  .description('Show last N secret fetches with actor + caller + timestamp (never the values)')
  .option('-n, --limit <n>', 'Max entries to show', '100')
  .action((opts: { limit: string }) => {
    const limit = Math.min(parseInt(opts.limit, 10) || 100, 100);
    const entries = [...getAuditLog()].reverse().slice(0, limit);
    if (!entries.length) {
      console.log('No audit entries yet.');
      return;
    }
    console.log(`Last ${entries.length} fetches:\n`);
    for (const e of entries) {
      const cached = e.cached ? ' [cached]' : '';
      console.log(`  ${e.timestamp}  ${e.event.padEnd(12)}  key=${e.secret_key_hash}  site=${e.site_slug}  caller=${e.caller_module}${cached}`);
    }
  });

program.parseAsync(process.argv).catch(err => {
  console.error('❌', err instanceof Error ? err.message : err);
  process.exit(1);
});
