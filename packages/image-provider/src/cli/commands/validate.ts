import { Command } from 'commander';
import pc from 'picocolors';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateImage } from '../../validation/index.js';

export const validateCommand = new Command('validate')
  .description('Run the validation pipeline on a local image file (diagnostic)')
  .argument('<path>', 'Path to image file')
  .option('--query <text>', 'Query to check relevance against', 'generic photograph')
  .action(async (filePath: string, opts: { query: string }) => {
    const absPath = resolve(process.cwd(), filePath);
    console.log(pc.cyan(`\nValidating: ${absPath}\n`));

    try {
      const buffer = readFileSync(absPath);
      const result = await validateImage(buffer, opts.query);

      console.log(`  Result:     ${result.passed ? pc.green('PASS') : pc.red('FAIL')}`);
      console.log(`  Dimensions: ${result.width}×${result.height}px`);
      console.log(`  Relevance:  ${result.relevance.toFixed(3)}  (min 0.270)`);
      console.log(`  Sharpness:  ${result.sharpness.toFixed(1)}  (min 80)`);
      console.log(`  Aesthetic:  ${result.aesthetic.toFixed(3)}`);
      console.log(`  AI-detect:  ${result.aiDetection.toFixed(3)}`);
      if (result.reasons.length > 0) {
        console.log(`  Issues:`);
        result.reasons.forEach(r => console.log(`    • ${r}`));
      }
    } catch (err) {
      console.error(pc.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });
