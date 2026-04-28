import { Command } from 'commander';
import pc from 'picocolors';
import { getImagesBySite, getAllImages } from '../../manifest/index.js';

export const listCommand = new Command('list')
  .description('List images tracked in the manifest')
  .option('--site <name>', 'Filter by site name')
  .action((opts: { site?: string }) => {
    const images = opts.site ? getImagesBySite(opts.site) : getAllImages();

    if (images.length === 0) {
      console.log(pc.yellow(`No images found${opts.site ? ` for site "${opts.site}"` : ''}.`));
      return;
    }

    console.log(`\n${images.length} image(s)${opts.site ? ` for ${pc.bold(opts.site)}` : ''}:\n`);
    for (const img of images) {
      console.log(`  ${pc.bold(img.id)}`);
      console.log(`    Query:  ${img.query}`);
      console.log(`    Source: ${img.source.kind} / ${img.source.provider}`);
      console.log(`    Alt:    ${img.alt.slice(0, 80)}`);
      console.log(`    Usage:  ${img.usages.map(u => `${u.site}/${u.slot}`).join(', ')}`);
      console.log(`    Cost:   $${img.cost.toFixed(4)}`);
      console.log('');
    }
  });
