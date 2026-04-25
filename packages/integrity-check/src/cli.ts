import * as path from 'path';
import * as fs from 'fs';
import { runScan } from './index';
import { printTerminalReport, renderReport } from './report/terminal';
import { writeJsonReport, readJsonReport } from './report/json';

function usage(): void {
  console.log(`
Usage:
  integrity scan [project-dir]        Run all scan layers (static + crawl)
  integrity scan --static-only        Static analysis only
  integrity scan --crawl-only         Crawl/route validation only
  integrity scan --runtime-only       Runtime Playwright check (needs --base-url)
  integrity scan --fix                Auto-fix obvious issues
  integrity scan --base-url <url>     HTTP-probe a running server
  integrity report <path>             Render a saved JSON report

Exit codes:
  0  Clean (no issues)
  1  Warnings only
  2  Errors present (build should fail)
`.trim());
}

async function cmdScan(args: string[]): Promise<void> {
  const staticOnly = args.includes('--static-only');
  const crawlOnly = args.includes('--crawl-only');
  const runtimeOnly = args.includes('--runtime-only');
  const fix = args.includes('--fix');

  const baseUrlIdx = args.indexOf('--base-url');
  const baseUrl = baseUrlIdx !== -1 ? args[baseUrlIdx + 1] : undefined;

  // First non-flag argument is the project dir
  const projectDir = args.find((a) => !a.startsWith('--') && a !== baseUrl) ?? '.';
  const absDir = path.resolve(projectDir);

  if (!fs.existsSync(absDir)) {
    console.error(`Error: project directory does not exist: ${absDir}`);
    process.exit(2);
  }

  const result = await runScan(absDir, { staticOnly, crawlOnly, runtimeOnly, fix, baseUrl });

  printTerminalReport(result);

  const reportPath = writeJsonReport(result);
  console.log(`Report saved: ${reportPath}\n`);

  const exitCode = result.stats.errors > 0 ? 2 : result.stats.warnings > 0 ? 1 : 0;
  process.exit(exitCode);
}

async function cmdReport(args: string[]): Promise<void> {
  const reportPath = args[0];
  if (!reportPath) {
    console.error('Usage: integrity report <path-to-json-report>');
    process.exit(1);
  }
  const data = readJsonReport(path.resolve(reportPath));
  renderReport(data);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    usage();
    process.exit(0);
  }

  switch (command) {
    case 'scan':
      await cmdScan(rest);
      break;
    case 'report':
      await cmdReport(rest);
      break;
    default:
      // Treat as shorthand: integrity <project-dir>
      await cmdScan([command, ...rest]);
  }
}

main().catch((err: Error) => {
  console.error('Fatal error:', err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(2);
});
