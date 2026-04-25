import { Command } from 'commander';
import pc from 'picocolors';
import { acquire, type AcquireOptions } from '../../orchestrator/index.js';

export const acquireCommand = new Command('acquire')
  .description('Find and acquire an image for a site slot')
  .requiredOption('--query <text>', 'Description of the image to find')
  .requiredOption('--site <name>', 'Site name (e.g. poker-zeno, roulette-community)')
  .requiredOption('--slot <name>', 'Slot name (e.g. hero, card-bg, banner)')
  .option('--hero', 'Use FLUX.1-pro for AI generation (higher quality, higher cost)', false)
  .option('--dry-run', 'Search and validate without storing or updating the manifest', false)
  .action(async (opts: { query: string; site: string; slot: string; hero: boolean; dryRun: boolean }) => {
    console.log(pc.bold(`\nimage-provider acquire`));
    console.log(`  Query: ${opts.query}`);
    console.log(`  Site:  ${opts.site}/${opts.slot}${opts.hero ? ' (hero)' : ''}${opts.dryRun ? ' [dry-run]' : ''}\n`);

    const validSites = ['poker-zeno', 'roulette-community'] as const;
    if (!validSites.includes(opts.site as AcquireOptions['site'])) {
      console.error(pc.red(`\n✗ Invalid site "${opts.site}". Must be one of: ${validSites.join(', ')}`));
      process.exit(1);
    }

    try {
      const result = await acquire({
        query: opts.query,
        site: opts.site as AcquireOptions['site'],
        slot: opts.slot,
        isHero: opts.hero,
        dryRun: opts.dryRun,
      });

      console.log(pc.green(`\n✔ Success (${result.source}${result.reused ? ', reused from manifest' : ''})`));
      console.log(`  ID:          ${result.record.id}`);
      console.log(`  Alt:         ${result.record.alt}`);
      console.log(`  Desktop URL: ${result.record.storage.variants.desktop || '(dry-run, not stored)'}`);
      console.log(`  Cost:        $${result.record.cost.toFixed(4)}`);
      if (opts.dryRun) {
        console.log(pc.yellow('\n  [dry-run] No files stored, manifest not updated.'));
      }
    } catch (err) {
      console.error(pc.red(`\n✗ ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });
