#!/usr/bin/env node
import { auditUrl } from './auditor.js';
import { printReport, saveJson, saveHtml } from './reporter.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = join(__dirname, '..', 'reports');

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log('Usage: seo-runner <url> [url2 ...] [--timeout <ms>] [--json] [--html]');
    console.log('Example: seo-runner https://pokerzeno.com http://localhost:3001 --html');
    process.exit(0);
  }

  const timeout = parseInt(args[args.indexOf('--timeout') + 1] ?? '15000', 10) || 15000;
  const doJson = args.includes('--json');
  const doHtml = args.includes('--html');

  const urls = args.filter(a => !a.startsWith('--') && !/^\d+$/.test(a));

  let hasFailure = false;

  for (const url of urls) {
    console.log(`\nAuditing: ${url} …`);
    try {
      const result = await auditUrl(url, { timeout });
      printReport(result);

      if (doJson) {
        const p = saveJson(result, REPORTS_DIR);
        console.log(`JSON saved: ${p}`);
      }
      if (doHtml) {
        const p = saveHtml(result, REPORTS_DIR);
        console.log(`HTML saved: ${p}`);
      }

      // Always save JSON
      if (!doJson) {
        const p = saveJson(result, REPORTS_DIR);
        console.log(`Report saved: ${p}`);
      }

      const criticals = result.findings.filter(f => f.severity === 'critical').length;
      if (criticals > 0) hasFailure = true;
    } catch (err) {
      console.error(`Error auditing ${url}:`, err);
      hasFailure = true;
    }
  }

  process.exit(hasFailure ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
