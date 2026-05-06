#!/usr/bin/env node
/**
 * CLI entrypoint for @chiefaia/prompt-evals.
 *
 * Subcommands:
 *
 *   run [--only <agent1,agent2,...>] [--out <path>] [--print]
 *     Run every `evals/<agent>.yaml` via the `promptfoo` CLI, aggregate
 *     results, write a JSON summary to <path> (default stdout).
 *     Exits non-zero when any agent regresses below baseline tolerance.
 *
 *   baseline [--update <agent1,agent2,...>] [--all]
 *     Update the baseline JSON for the given agent(s) using the latest
 *     run. Without --update, prints the current baselines as JSON.
 *
 *   list
 *     Print every agent eval suite name discovered under `evals/`.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeBaseline, loadBaseline } from './baseline.js';
import { baselinesDir, evalsDir } from './paths.js';
import { runAll } from './runner.js';

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

function only(args: Argv): string[] | undefined {
  const raw = args.flags['only'];
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function run(args: Argv): void {
  const onlyList = only(args);
  const promptfooBin = args.flags['promptfoo'];
  const summary = runAll({
    ...(onlyList !== undefined ? { only: onlyList } : {}),
    ...(promptfooBin ? { promptfooBin } : {})
  });
  const out = JSON.stringify(summary, null, 2);
  if (args.flags['out']) {
    writeFileSync(args.flags['out'], out, 'utf-8');
  }
  if (args.flags['print'] === '1' || !args.flags['out']) {
    console.log(out);
  }
  if (!summary.ok) {
    process.exit(2);
  }
}

function baseline(args: Argv): void {
  const updateRaw = args.flags['update'];
  const updateAll = args.flags['all'] === '1';
  if (!updateRaw && !updateAll) {
    // Print all baselines as JSON.
    const dir = baselinesDir();
    if (!existsSync(dir)) {
      console.log(JSON.stringify({ ok: true, baselines: [] }));
      return;
    }
    const all = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const agent = f.replace(/\.json$/, '');
        return loadBaseline(agent);
      })
      .filter((b) => b !== null);
    console.log(JSON.stringify({ ok: true, baselines: all }, null, 2));
    return;
  }
  const summary = runAll({});
  const updateList = updateAll
    ? summary.perAgent.map((r) => r.agent)
    : (updateRaw ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  const updated = [];
  for (const agent of updateList) {
    const r = summary.perAgent.find((p) => p.agent === agent);
    if (!r) {
      console.error(`[prompt-evals] no run result for ${agent} — skipping`);
      continue;
    }
    const written = writeBaseline(r);
    updated.push(written);
  }
  console.log(JSON.stringify({ ok: true, updated }, null, 2));
}

function list(): void {
  const dir = evalsDir();
  const items = readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') && !f.startsWith('_'))
    .map((f) => f.replace(/\.yaml$/, ''))
    .sort();
  for (const agent of items) {
    const path = join(dir, `${agent}.yaml`);
    const text = readFileSync(path, 'utf-8');
    const descMatch = text.match(/^description:\s*['"]?([^'"\n]+)/m);
    console.log(JSON.stringify({ agent, path, description: descMatch?.[1] ?? null }));
  }
}

function usage(): never {
  console.error(
    [
      'Usage: caia-prompt-evals <subcommand> [flags]',
      '',
      'Subcommands:',
      '  run [--only <agent1,agent2,...>] [--out <path>] [--print] [--promptfoo <bin>]',
      '  baseline [--update <agent1,agent2,...>] [--all]',
      '  list',
      '',
      'Examples:',
      '  caia-prompt-evals list',
      '  caia-prompt-evals run --only caia-po,caia-ba',
      '  caia-prompt-evals baseline --all'
    ].join('\n')
  );
  process.exit(2);
}

export function main(argv: string[]): void {
  const [sub, ...rest] = argv;
  const args = parseArgs(rest);
  switch (sub) {
    case 'run':
      run(args);
      return;
    case 'baseline':
      baseline(args);
      return;
    case 'list':
      list();
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
    import.meta.url.endsWith(process.argv[1]) ||
    fileURLToPath(import.meta.url) === process.argv[1]);

if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (e: unknown) {
    console.error(`[caia-prompt-evals] fatal: ${String(e)}`);
    process.exit(1);
  }
}
