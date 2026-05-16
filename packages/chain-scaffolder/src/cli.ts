import { Command } from 'commander';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { scaffoldFromLlm } from './llm.js';
import { specToYaml } from './schema.js';
import { parseBacklogLine } from './parse-backlog-line.js';
import type { Machine } from './types.js';

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

      const yaml = specToYaml(result.spec);
      const outDir = opts.outDir ?? DEFAULT_AGENT_MEMORY_DIR;
      const outFile = resolve(outDir, `${item.id.replace(/-/g, '_')}_phases.yaml`);

      const shouldWrite = opts.write !== false;
      if (shouldWrite) {
        if (!existsSync(dirname(outFile))) mkdirSync(dirname(outFile), { recursive: true });
        writeFileSync(outFile, yaml, 'utf8');
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
        process.stdout.write(yaml);
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
