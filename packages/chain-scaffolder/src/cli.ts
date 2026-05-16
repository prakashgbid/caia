import { Command } from 'commander';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import { scaffoldFromLlm } from './llm.js';
import { specToYaml } from './schema.js';
import { parseBacklogLine } from './parse-backlog-line.js';
import type { Machine } from './types.js';
import {
  scaffoldFromBacklogItem,
  validateBacklogItem,
  type BacklogItem,
} from './templated.js';
import { listPending, nextAvailable, scaffoldNext } from './backlog.js';

const DEFAULT_AGENT_MEMORY_DIR = resolve(homedir(), 'Documents/projects/agent-memory');
const DEFAULT_CHAIN_BASE_DIR = resolve(homedir(), '.caia/chain');

interface FromLlmCliOptions {
  contextFiles?: string[];
  provider?: 'auto' | 'claude' | 'local' | 'fixture';
  machine?: Machine;
  fewShotExample?: string;
  outDir?: string;
  routerUrl?: string;
  claudeBin?: string;
  /** Commander maps `--no-write` to `opts.write = false`. */
  write?: boolean;
  json?: boolean;
  fixtureFile?: string;
}

export function buildCli(): Command {
  const program = new Command();
  program
    .name('caia-scaffold')
    .description('Scaffold caia-chain definitions from backlog items')
    .version('0.1.0');

  program
    .command('from-llm')
    .description('Generate a chain definition from a loose backlog line via an LLM')
    .argument(
      '<backlog-line...>',
      'Backlog line: "<id> :: <title> :: <description>". Joined with spaces if passed as multiple args.',
    )
    .option('-c, --context-files <files...>', 'Extra file(s) to include verbatim as context')
    .option('-p, --provider <p>', 'Provider: auto | claude | local | fixture', 'auto')
    .option('-m, --machine <m>', 'Machine routing hint: m3 | m1 | stolution')
    .option('--few-shot-example <path>', 'Path to few-shot example YAML (defaults to sps_router_critical_fixes_phases.yaml)')
    .option('--out-dir <dir>', `Directory to write phases.yaml (default: ${DEFAULT_AGENT_MEMORY_DIR})`)
    .option('--router-url <url>', 'local-llm-router base URL', 'http://127.0.0.1:7411')
    .option('--claude-bin <bin>', 'claude CLI binary', 'claude')
    .option('--no-write', 'Print the YAML to stdout instead of writing to disk')
    .option('--json', 'Emit a JSON envelope with metadata (chain_id, path, attempts, raw)')
    .option('--fixture-file <path>', '(testing) read provider response from this file instead of calling the LLM')
    .action(async (backlogLineParts: string[], opts: FromLlmCliOptions) => {
      const backlogLine = backlogLineParts.join(' ');
      const item = parseBacklogLine(backlogLine);
      if (opts.machine) item.machine = opts.machine;

      let fixtureResponse: string | undefined;
      if (opts.provider === 'fixture' || opts.fixtureFile) {
        if (!opts.fixtureFile) {
          throw new Error('--provider fixture requires --fixture-file <path>');
        }
        const fs = await import('node:fs/promises');
        fixtureResponse = await fs.readFile(opts.fixtureFile, 'utf8');
      }

      const scaffoldOpts: Parameters<typeof scaffoldFromLlm>[1] = {
        provider: opts.provider === 'fixture' ? 'fixture' : (opts.provider ?? 'auto'),
      };
      if (fixtureResponse !== undefined) scaffoldOpts.fixtureResponse = fixtureResponse;
      if (opts.contextFiles !== undefined) scaffoldOpts.contextFiles = opts.contextFiles;
      if (opts.routerUrl !== undefined) scaffoldOpts.routerBaseUrl = opts.routerUrl;
      if (opts.claudeBin !== undefined) scaffoldOpts.claudeBin = opts.claudeBin;
      if (opts.fewShotExample !== undefined) scaffoldOpts.fewShotExamplePath = opts.fewShotExample;
      const result = await scaffoldFromLlm(item, scaffoldOpts);

      const yamlOut = specToYaml(result.spec);
      const outDir = opts.outDir ?? DEFAULT_AGENT_MEMORY_DIR;
      const outFile = resolve(outDir, `${item.id.replace(/-/g, '_')}_phases.yaml`);

      const shouldWrite = opts.write !== false;
      if (shouldWrite) {
        if (!existsSync(dirname(outFile))) mkdirSync(dirname(outFile), { recursive: true });
        writeFileSync(outFile, yamlOut, 'utf8');
      }

      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            {
              chain_id: result.chain_id,
              phases_yaml_path: shouldWrite ? outFile : null,
              attempts: result.attempts,
              provider: result.raw.provider,
              usage: result.raw.usage ?? null,
              phase_count: result.spec.phases.length,
            },
            null,
            2,
          ) + '\n',
        );
      } else if (!shouldWrite) {
        process.stdout.write(yamlOut);
      } else {
        process.stdout.write(`✔ scaffolded ${result.chain_id} → ${outFile}\n`);
        process.stdout.write(`  phases: ${result.spec.phases.length}  provider: ${result.raw.provider}  attempts: ${result.attempts.length}\n`);
      }
    });

  program
    .command('validate')
    .description('Parse a phases YAML and report schema errors (read-only)')
    .argument('<path>', 'phases YAML file')
    .action(async (path: string) => {
      const fs = await import('node:fs/promises');
      const yamlText = await fs.readFile(resolve(path), 'utf8');
      const { parseScaffolderSpec } = await import('./schema.js');
      try {
        const spec = parseScaffolderSpec(yamlText);
        process.stdout.write(`✔ ${path} is valid — ${spec.phases.length} phase(s)\n`);
      } catch (e) {
        process.stderr.write(`✘ ${path} is invalid:\n${(e as Error).message}\n`);
        process.exit(1);
      }
    });

  // Templated path (deterministic, zero-LLM). Takes a fully-structured
  // backlog-item yaml and produces state.json + phases.yaml + runner.sh.
  program
    .command('from-template')
    .description('Scaffold a chain from a fully-structured backlog-item yaml (no LLM)')
    .argument('<yaml-file>', 'path to a backlog-item yaml file')
    .option('--force', 'overwrite existing chain artifacts', false)
    .option('--json', 'emit machine-readable output', false)
    .action((yamlFile: string, opts: { force?: boolean; json?: boolean }) => {
      let item: unknown;
      try {
        item = yaml.load(readFileSync(yamlFile, 'utf8'));
      } catch (e) {
        process.stderr.write(`error: cannot read ${yamlFile}: ${(e as Error).message}\n`);
        process.exit(2);
      }
      try {
        validateBacklogItem(item);
      } catch (e) {
        process.stderr.write(`error: ${(e as Error).message}\n`);
        process.exit(4);
      }
      let result;
      try {
        const scaffoldOpts: { force?: boolean } = {};
        if (opts.force) scaffoldOpts.force = true;
        result = scaffoldFromBacklogItem(item as BacklogItem, scaffoldOpts);
      } catch (e) {
        const msg = (e as Error).message;
        process.stderr.write(`error: ${msg}\n`);
        process.exit(msg.includes('already exists') ? 3 : 1);
      }
      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result)}\n`);
      } else {
        process.stdout.write(
          `scaffolded chain=${result.chainId}\n` +
            `  state:  ${result.stateFile}\n` +
            `  phases: ${result.phasesYaml}\n` +
            `  runner: ${result.runnerScript}\n` +
            `chain is paused — \`caia-chain resume --chain-id ${result.chainId} --phases ${result.phasesYaml}\` to dispatch.\n`,
        );
      }
    });

  program
    .command('next-available')
    .description('Print the next dispatchable structured item (templated path); exit 1 if none')
    .requiredOption('--backlog <path>', 'directory or file containing structured backlog items')
    .option('--json', 'emit machine-readable output', false)
    .action((opts: { backlog: string; json?: boolean }) => {
      const next = nextAvailable(opts.backlog);
      if (!next) {
        if (opts.json) process.stdout.write(`null\n`);
        else process.stderr.write('no dispatchable item available\n');
        process.exit(1);
      }
      const out = {
        id: next.item.id,
        title: next.item.title,
        machine: next.item.machine,
        source: next.source,
        phase_count: next.item.phase_count,
      };
      if (opts.json) process.stdout.write(`${JSON.stringify(out)}\n`);
      else
        process.stdout.write(
          `${out.id}\t${out.machine}\tphases=${out.phase_count}\t${out.source}\n  ${out.title}\n`,
        );
    });

  program
    .command('scaffold-next')
    .description(
      'Atomically claim and scaffold the next dispatchable structured item (templated path); exit 1 if none, exit 3 if conflict',
    )
    .requiredOption('--backlog <path>', 'directory or file containing structured backlog items')
    .option('--force', 'overwrite existing chain artifacts', false)
    .option('--json', 'emit machine-readable output', false)
    .action((opts: { backlog: string; force?: boolean; json?: boolean }) => {
      let result;
      try {
        const scaffoldOpts: { force?: boolean } = {};
        if (opts.force) scaffoldOpts.force = true;
        result = scaffoldNext(opts.backlog, scaffoldOpts);
      } catch (e) {
        const msg = (e as Error).message;
        process.stderr.write(`error: ${msg}\n`);
        process.exit(msg.includes('already exists') ? 3 : 1);
      }
      if (!result) {
        if (opts.json) process.stdout.write(`null\n`);
        else process.stderr.write('no dispatchable item available\n');
        process.exit(1);
      }
      const out = {
        id: result.entry.item.id,
        title: result.entry.item.title,
        machine: result.entry.item.machine,
        source: result.entry.source,
        phase_count: result.entry.item.phase_count,
        scaffolded: result.scaffolded,
      };
      if (opts.json) process.stdout.write(`${JSON.stringify(out)}\n`);
      else
        process.stdout.write(
          `scaffolded chain=${out.id}\n` +
            `  machine: ${out.machine}\n` +
            `  source:  ${out.source}\n` +
            `  state:   ${result.scaffolded.stateFile}\n` +
            `  phases:  ${result.scaffolded.phasesYaml}\n` +
            `  runner:  ${result.scaffolded.runnerScript}\n` +
            `chain is paused — orchestrator unpauses on next tick.\n`,
        );
    });

  program
    .command('list-pending')
    .description('List structured backlog items that have not been scaffolded yet')
    .requiredOption('--backlog <path>', 'directory or file containing structured backlog items')
    .option('--json', 'emit machine-readable output', false)
    .option('--strict', 'exit non-zero when there are zero pending items', false)
    .action((opts: { backlog: string; json?: boolean; strict?: boolean }) => {
      const pending = listPending(opts.backlog);
      if (opts.json) {
        process.stdout.write(
          `${JSON.stringify(
            pending.map((p) => ({
              id: p.item.id,
              title: p.item.title,
              machine: p.item.machine,
              depsResolved: p.depsResolved,
              blockedReason: p.blockedReason ?? null,
              source: p.source,
            })),
          )}\n`,
        );
      } else if (pending.length === 0) {
        process.stdout.write('(no pending items)\n');
      } else {
        for (const p of pending) {
          const status = p.depsResolved ? 'READY' : `BLOCKED (${p.blockedReason})`;
          process.stdout.write(`${p.item.id}\t${p.item.machine}\t${status}\n  ${p.item.title}\n`);
        }
      }
      if (opts.strict && pending.length === 0) process.exit(1);
    });

  return program;
}

export async function main(argv: string[]): Promise<void> {
  const program = buildCli();
  await program.parseAsync(argv);
}

const isDirect =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/caia-scaffold.js') || process.argv[1].endsWith('/cli.js'));
if (isDirect) {
  main(process.argv).catch((e) => {
    process.stderr.write(`caia-scaffold: ${(e as Error).message}\n`);
    process.exit(1);
  });
}

// keep referenced for d.ts emit
export const DEFAULTS = {
  DEFAULT_AGENT_MEMORY_DIR,
  DEFAULT_CHAIN_BASE_DIR,
};
