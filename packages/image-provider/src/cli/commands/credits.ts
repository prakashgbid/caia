import { Command } from 'commander';
import pc from 'picocolors';
import { getSiteCredits } from '../../lib/site-helper.js';

export const creditsCommand = new Command('credits')
  .description('Print image attribution credits for a site (use for /image-credits page)')
  .requiredOption('--site <name>', 'Site name')
  .action((opts: { site: string }) => {
    const credits = getSiteCredits(opts.site);

    if (credits.length === 0) {
      console.log(pc.yellow(`No images found for site "${opts.site}".`));
      return;
    }

    console.log(`\nImage credits for ${pc.bold(opts.site)} (${credits.length} image(s)):\n`);
    for (const c of credits) {
      console.log(`  Slot: ${pc.bold(c.slot)}  —  ${c.alt.slice(0, 60)}`);
      if (c.photographer) {
        const link = c.photographerUrl ? ` <${c.photographerUrl}>` : '';
        console.log(`    Photo by: ${c.photographer}${link}`);
      }
      console.log(`    License: ${c.license}${c.licenseUrl ? `  <${c.licenseUrl}>` : ''}`);
      if (c.sourceUrl) console.log(`    Source: ${c.sourceUrl}`);
      console.log('');
    }
  });
