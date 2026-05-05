#!/usr/bin/env node
/**
 * CLI entrypoint for @chiefaia/curator.
 *
 * Subcommands:
 *
 *   daily [--repo <path>] [--memory <dir>] [--reports <dir>]
 *         [--out <path>] [--print]
 *     Run all phase-1 scanners, write a daily-digest markdown to
 *     `<reportsDir>/curator/<YYYY-MM-DD>-digest.md`. With --print the
 *     digest is also echoed to stdout.
 *
 *   list-scanners
 *     Print the registered scanners (id + category + name) — one per
 *     line, JSON-serialized for easy piping.
 *
 *   run-one <scannerId> [--repo <path>] [--memory <dir>] [--reports <dir>]
 *     Run a single scanner and print findings as JSON. Useful for
 *     debugging or for piping into other tools.
 *
 *   emit-alarms [--repo <path>] [--memory <dir>] [--reports <dir>]
 *               [--alarms-dir <path>] [--force] [--print]
 *     (Phase-2) Run all phase-1 scanners, classify findings into
 *     actions, and write the urgent (`alarm`) ones as one .md per
 *     alarm under `<reportsDir>/curator/alarms/`. Idempotent — existing
 *     files are preserved unless `--force`. With `--print` the slugs of
 *     written + skipped alarms are echoed to stdout.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';

import {
  findingsToActions,
  writeAlarms,
  type AlarmAction
} from './actions/index.js';
import { defaultScanContext, type DefaultContextOptions } from './context.js';
import { renderDigest } from './digest.js';
import { runScan } from './orchestrator.js';
import { phase1Scanners } from './scanners/index.js';
import type { ScanContext } from './types.js';

interface Argv {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Argv {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = '1';
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function buildCtx(args: Argv): ScanContext {
  const opts: DefaultContextOptions = {};
  if (args.flags['repo']) opts.repoRoot = args.flags['repo'];
  if (args.flags['memory']) opts.memoryDir = args.flags['memory'];
  if (args.flags['reports']) opts.reportsDir = args.flags['reports'];
  return defaultScanContext(opts);
}

function dateString(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

async function daily(args: Argv): Promise<void> {
  const ctx = buildCtx(args);
  const result = await runScan(phase1Scanners, ctx);

  const date = (ctx.now ?? ((): Date => new Date()))();
  const md = renderDigest(result, { date });

  const defaultOut = join(
    ctx.reportsDir,
    'curator',
    `${dateString(date)}-digest.md`
  );
  const outPath = args.flags['out']
    ? pathResolve(args.flags['out'])
    : defaultOut;
  if (!existsSync(dirname(outPath))) {
    mkdirSync(dirname(outPath), { recursive: true });
  }
  writeFileSync(outPath, md, 'utf-8');

  if (args.flags['print']) {
    console.log(md);
  }
  console.log(
    JSON.stringify({
      ok: true,
      digest: outPath,
      findingCount: result.findings.length,
      scanners: result.perScanner.length
    })
  );
}

function listScanners(): void {
  for (const sc of phase1Scanners) {
    console.log(JSON.stringify({ id: sc.id, name: sc.name, category: sc.category }));
  }
}

async function runOne(args: Argv): Promise<void> {
  const id = args.positional[0];
  if (!id) {
    console.error('usage: caia-curator run-one <scannerId> [flags]');
    process.exit(2);
  }
  const sc = phase1Scanners.find((s) => s.id === id);
  if (!sc) {
    console.error(
      `unknown scanner: ${id}. Available: ${phase1Scanners.map((s) => s.id).join(', ')}`
    );
    process.exit(2);
  }
  const ctx = buildCtx(args);
  const findings = await sc.scan(ctx);
  console.log(JSON.stringify({ ok: true, scannerId: sc.id, findings }, null, 2));
}

async function emitAlarms(args: Argv): Promise<void> {
  const ctx = buildCtx(args);
  const result = await runScan(phase1Scanners, ctx);
  const actions = findingsToActions(result.findings);
  const alarms = actions.filter((a): a is AlarmAction => a.kind === 'alarm');

  const alarmsDirArg = args.flags['alarms-dir'];
  const force = args.flags['force'] === '1';
  const emitted = alarmsDirArg
    ? writeAlarms(alarms, { alarmsDir: pathResolve(alarmsDirArg), force })
    : writeAlarms(alarms, { reportsDir: ctx.reportsDir, force });

  if (args.flags['print']) {
    for (const w of emitted.written) console.log(`written: ${w.slug} -> ${w.path}`);
    for (const s of emitted.skipped) console.log(`skipped: ${s.slug} -> ${s.path}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      alarmsDir: emitted.outputDir,
      writtenCount: emitted.writtenCount,
      skippedCount: emitted.skippedCount,
      written: emitted.written,
      skipped: emitted.skipped,
      totalAlarms: alarms.length,
      totalActions: actions.length,
      totalFindings: result.findings.length
    })
  );
}

function usage(): never {
  console.error(
    [
      'Usage: caia-curator <subcommand> [flags]',
      '',
      'Subcommands:',
      '  daily [--repo <path>] [--memory <dir>] [--reports <dir>] [--out <path>] [--print]',
      '  list-scanners',
      '  run-one <scannerId> [--repo <path>] [--memory <dir>] [--reports <dir>]',
      '  emit-alarms [--repo <path>] [--memory <dir>] [--reports <dir>] [--alarms-dir <path>] [--force] [--print]',
      '',
      'Env vars:',
      '  CAIA_MEMORY_DIR     overrides default agent/memory path',
      '  CAIA_REPORTS_DIR    overrides default reports dir'
    ].join('\n')
  );
  process.exit(2);
}

export async function main(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  const args = parseArgs(rest);
  switch (sub) {
    case 'daily':
      await daily(args);
      return;
    case 'list-scanners':
      listScanners();
      return;
    case 'run-one':
      await runOne(args);
      return;
    case 'emit-alarms':
      await emitAlarms(args);
      return;
    case undefined:
    case '--help':
    case '-h':
      usage();
      return;
    default:
      console.error(`unknown subcommand: ${sub}`);
      usage();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1]));

if (isMain) {
  main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(`[caia-curator] fatal: ${String(e)}`);
    process.exit(1);
  });
}
