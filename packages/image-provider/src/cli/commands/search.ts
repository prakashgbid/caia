import { Command } from 'commander';
import pc from 'picocolors';
import { searchAllSources } from '../../sources/index.js';

export const searchCommand = new Command('search')
  .description('Search web sources and preview candidates (no download, no manifest update)')
  .argument('<query>', 'Search query')
  .option('-n, --per-page <n>', 'Results per source', '10')
  .action(async (query: string, opts: { perPage: string }) => {
    console.log(pc.cyan(`\nSearching: "${query}"\n`));
    try {
      const results = await searchAllSources(query, parseInt(opts.perPage, 10));
      if (results.length === 0) {
        console.log(pc.yellow('No results. Check your API keys in .env.'));
        return;
      }
      console.log(`${results.length} candidates (top 20 shown):\n`);
      for (const r of results.slice(0, 20)) {
        console.log(`  [${r.provider}] ${r.id}`);
        console.log(`    ${r.width}×${r.height}px — ${r.alt.slice(0, 70)}`);
        console.log(`    ${r.previewUrl.slice(0, 90)}`);
        console.log('');
      }
    } catch (err) {
      console.error(pc.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });
