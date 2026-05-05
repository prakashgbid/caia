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
 *     (Phase-2 PR-1) Run all phase-1 scanners, classify findings into
 *     actions, and write the urgent (`alarm`) ones as one .md per
 *     alarm under `<reportsDir>/curator/alarms/`. Idempotent — existing
 *     files are preserved unless `--force`.
 *
 *   emit-pr-proposals [--repo <path>] [--memory <dir>] [--reports <dir>]
 *                     [--out-dir <path>] [--force] [--print]
 *     (Phase-2 PR-2) Same pipeline, write the `pr-proposal` actions
 *     under `<reportsDir>/curator/pr-proposals/`.
 *
 *   emit-backlog-directives [--repo <path>] [--memory <dir>] [--reports <dir>]
 *                           [--out-dir <path>] [--force] [--print]
 *     (Phase-2 PR-2) Same pipeline, write the `backlog-directive`
 *     actions under `<reportsDir>/curator/backlog-directives/`.
 *
 *   emit-industry-briefings [--repo <path>] [--memory <dir>] [--reports <dir>]
 *                           [--out-dir <path>] [--watchlist <path>]
 *                           [--force] [--print]
 *     (Phase-2 PR-3) Load the operator-curated watchlist
 *     (`<memoryDir>/curator-watchlist.json` by default) and emit one
 *     industry-briefing markdown per entry under
 *     `<reportsDir>/curator/industry-briefings/`.
 *
 *   act [--repo <path>] [--memory <dir>] [--reports <dir>]
 *       [--alarms-dir <path>] [--pr-proposals-dir <path>]
 *       [--backlog-directives-dir <path>]
 *       [--industry-briefings-dir <path>] [--watchlist <path>]
 *       [--force] [--print] [--skip-watchlist]
 *     (Phase-2 PR-3) Unified runner: scans, classifies findings,
 *     loads the watchlist, and emits all 4 output modes (alarms +
 *     pr-proposals + backlog-directives + industry-briefings) in one
 *     pass. This is what the daily LaunchAgent / cron will invoke.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as pathResolve } from 'node:path';

import {
  findingsToActions,
  loadWatchlist,
  runActDay,
  writeAlarms,
  writeBacklogDirectives,
  writeIndustryBriefings,
  writePrProposals,
  type AlarmAction,
  type BacklogDirectiveAction,
  type EmitResult,
  type IndustryBriefingAction,
  type PrProposalAction,
  type RunActDayResult
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

/**
 * Print the JSON summary returned by an emit-* subcommand. Centralised
 * so all three (alarm / pr-proposal / backlog-directive) use the same
 * shape.
 */
function printEmitSummary(
  kind: 'alarm' | 'pr-proposal' | 'backlog-directive',
  emitted: EmitResult,
  matching: number,
  totalActions: number,
  totalFindings: number,
  print: boolean
): void {
  if (print) {
    for (const w of emitted.written) console.log(`written: ${w.slug} -> ${w.path}`);
    for (const s of emitted.skipped) console.log(`skipped: ${s.slug} -> ${s.path}`);
  }
  console.log(
    JSON.stringify({
      ok: true,
      kind,
      outputDir: emitted.outputDir,
      writtenCount: emitted.writtenCount,
      skippedCount: emitted.skippedCount,
      written: emitted.written,
      skipped: emitted.skipped,
      matchingActions: matching,
      totalActions,
      totalFindings
    })
  );
}

async function emitAlarms(args: Argv): Promise<void> {
  const ctx = buildCtx(args);
  const result = await runScan(phase1Scanners, ctx);
  const actions = findingsToActions(result.findings);
  const matching = actions.filter((a): a is AlarmAction => a.kind === 'alarm');

  const outArg = args.flags['alarms-dir'];
  const force = args.flags['force'] === '1';
  const emitted = outArg
    ? writeAlarms(matching, { alarmsDir: pathResolve(outArg), force })
    : writeAlarms(matching, { reportsDir: ctx.reportsDir, force });

  printEmitSummary(
    'alarm',
    emitted,
    matching.length,
    actions.length,
    result.findings.length,
    args.flags['print'] === '1'
  );
}

async function emitPrProposals(args: Argv): Promise<void> {
  const ctx = buildCtx(args);
  const result = await runScan(phase1Scanners, ctx);
  const actions = findingsToActions(result.findings);
  const matching = actions.filter(
    (a): a is PrProposalAction => a.kind === 'pr-proposal'
  );

  const outArg = args.flags['out-dir'];
  const force = args.flags['force'] === '1';
  const emitted = outArg
    ? writePrProposals(matching, { outDir: pathResolve(outArg), force })
    : writePrProposals(matching, { reportsDir: ctx.reportsDir, force });

  printEmitSummary(
    'pr-proposal',
    emitted,
    matching.length,
    actions.length,
    result.findings.length,
    args.flags['print'] === '1'
  );
}

async function emitBacklogDirectives(args: Argv): Promise<void> {
  const ctx = buildCtx(args);
  const result = await runScan(phase1Scanners, ctx);
  const actions = findingsToActions(result.findings);
  const matching = actions.filter(
    (a): a is BacklogDirectiveAction => a.kind === 'backlog-directive'
  );

  const outArg = args.flags['out-dir'];
  const force = args.flags['force'] === '1';
  const emitted = outArg
    ? writeBacklogDirectives(matching, { outDir: pathResolve(outArg), force })
    : writeBacklogDirectives(matching, { reportsDir: ctx.reportsDir, force });

  printEmitSummary(
    'backlog-directive',
    emitted,
    matching.length,
    actions.length,
    result.findings.length,
    args.flags['print'] === '1'
  );
}

async function emitIndustryBriefings(args: Argv): Promise<void> {
  const ctx = buildCtx(args);
  // Industry briefings come from the watchlist, NOT from scanner findings.
  // We still synthesise the per-emitter JSON shape so consumers see the
  // same contract as the other emit-* commands.
  const watchlistPath = args.flags['watchlist'];
  const briefings: IndustryBriefingAction[] = watchlistPath
    ? loadWatchlist({ path: pathResolve(watchlistPath) })
    : loadWatchlist({ memoryDir: ctx.memoryDir });

  const outArg = args.flags['out-dir'];
  const force = args.flags['force'] === '1';
  const emitted = outArg
    ? writeIndustryBriefings(briefings, { outDir: pathResolve(outArg), force })
    : writeIndustryBriefings(briefings, { reportsDir: ctx.reportsDir, force });

  if (args.flags['print'] === '1') {
    for (const w of emitted.written) console.log(`written: ${w.slug} -> ${w.path}`);
    for (const s of emitted.skipped) console.log(`skipped: ${s.slug} -> ${s.path}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      kind: 'industry-briefing',
      outputDir: emitted.outputDir,
      writtenCount: emitted.writtenCount,
      skippedCount: emitted.skippedCount,
      written: emitted.written,
      skipped: emitted.skipped,
      matchingActions: briefings.length,
      // No findings or classifier-driven actions in this mode.
      totalActions: briefings.length,
      totalFindings: 0
    })
  );
}

async function act(args: Argv): Promise<void> {
  const ctx = buildCtx(args);
  const force = args.flags['force'] === '1';
  const opts: Parameters<typeof runActDay>[1] = { force };
  if (args.flags['alarms-dir']) opts.alarmsDir = pathResolve(args.flags['alarms-dir']);
  if (args.flags['pr-proposals-dir'])
    opts.prProposalsDir = pathResolve(args.flags['pr-proposals-dir']);
  if (args.flags['backlog-directives-dir'])
    opts.backlogDirectivesDir = pathResolve(args.flags['backlog-directives-dir']);
  if (args.flags['industry-briefings-dir'])
    opts.industryBriefingsDir = pathResolve(args.flags['industry-briefings-dir']);
  if (args.flags['watchlist']) opts.watchlistPath = pathResolve(args.flags['watchlist']);
  if (args.flags['skip-watchlist'] === '1') opts.skipIndustryBriefings = true;

  const r: RunActDayResult = await runActDay(ctx, opts);

  if (args.flags['print'] === '1') {
    for (const e of [
      r.emit.alarms,
      r.emit.prProposals,
      r.emit.backlogDirectives,
      r.emit.industryBriefings
    ]) {
      for (const w of e.written) console.log(`written: ${w.kind}/${w.slug} -> ${w.path}`);
      for (const s of e.skipped) console.log(`skipped: ${s.kind}/${s.slug} -> ${s.path}`);
    }
  }

  console.log(
    JSON.stringify({
      ok: true,
      findingCount: r.findingCount,
      classifiedCount: r.classifiedCount,
      watchlistCount: r.watchlistCount,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      emit: {
        alarms: {
          outputDir: r.emit.alarms.outputDir,
          writtenCount: r.emit.alarms.writtenCount,
          skippedCount: r.emit.alarms.skippedCount
        },
        prProposals: {
          outputDir: r.emit.prProposals.outputDir,
          writtenCount: r.emit.prProposals.writtenCount,
          skippedCount: r.emit.prProposals.skippedCount
        },
        backlogDirectives: {
          outputDir: r.emit.backlogDirectives.outputDir,
          writtenCount: r.emit.backlogDirectives.writtenCount,
          skippedCount: r.emit.backlogDirectives.skippedCount
        },
        industryBriefings: {
          outputDir: r.emit.industryBriefings.outputDir,
          writtenCount: r.emit.industryBriefings.writtenCount,
          skippedCount: r.emit.industryBriefings.skippedCount
        }
      }
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
      '  emit-pr-proposals [--repo <path>] [--memory <dir>] [--reports <dir>] [--out-dir <path>] [--force] [--print]',
      '  emit-backlog-directives [--repo <path>] [--memory <dir>] [--reports <dir>] [--out-dir <path>] [--force] [--print]',
      '  emit-industry-briefings [--repo <path>] [--memory <dir>] [--reports <dir>] [--out-dir <path>] [--watchlist <path>] [--force] [--print]',
      '  act [--repo <path>] [--memory <dir>] [--reports <dir>] [--watchlist <path>] [--alarms-dir <path>] [--pr-proposals-dir <path>] [--backlog-directives-dir <path>] [--industry-briefings-dir <path>] [--force] [--print] [--skip-watchlist]',
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
    case 'emit-pr-proposals':
      await emitPrProposals(args);
      return;
    case 'emit-backlog-directives':
      await emitBacklogDirectives(args);
      return;
    case 'emit-industry-briefings':
      await emitIndustryBriefings(args);
      return;
    case 'act':
      await act(args);
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
