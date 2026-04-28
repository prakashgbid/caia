import { Command } from 'commander';
import pc from 'picocolors';
import { appendUsage, getImageById } from '../../manifest/index.js';

export const reuseCommand = new Command('reuse')
  .description('Add an existing image to a new site slot without re-fetching')
  .requiredOption('--id <imageId>', 'Image ID from the manifest')
  .requiredOption('--site <name>', 'Target site name')
  .requiredOption('--slot <name>', 'Target slot name')
  .action((opts: { id: string; site: string; slot: string }) => {
    const record = getImageById(opts.id);
    if (!record) {
      console.error(pc.red(`✗ Image not found in manifest: ${opts.id}`));
      console.error(`  Run: image-provider list  to see available images`);
      process.exit(1);
    }

    appendUsage(opts.id, { site: opts.site, slot: opts.slot, addedAt: new Date().toISOString() });
    console.log(pc.green(`✔ Image ${opts.id} is now registered for ${opts.site}/${opts.slot}`));
    console.log(`  Desktop URL: ${record.storage.variants.desktop}`);
  });
