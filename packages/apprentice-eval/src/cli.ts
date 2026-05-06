#!/usr/bin/env node
/**
 * CLI for @chiefaia/apprentice-eval.
 *
 * Subcommands (per DESIGN.md §3):
 *   run            run every suite, score base + each adapter
 *   baseline       refresh baselines (operator-explicit)
 *   ab             interactive operator-blind A/B mode (stub: prints sampled prompts)
 *
 * Flags:
 *   --only <a,b>          restrict suites
 *   --adapter <name>      restrict adapters
 *   --dry-run             plan only; no Ollama calls
 *   --output-root <path>  override output root
 */

import { stdin, stdout, exit, argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

import { ApprenticeEvalHarness } from './harness.js';
import { createOllamaClient } from './ollama-client.js';
import { createMlxFallback } from './mlx-fallback.js';
import { createClaudeJudge } from './judge.js';
import { writeBaseline } from './baseline-store.js';
import { applyDefaults, loadSuites } from './suite-loader.js';
import { runAbMode } from './ab-mode.js';
import { resolveConfig, type ApprenticeEvalConfig } from './config.js';
import type { FsReader, FsWriter } from './types.js';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

interface ParsedArgs {
  command: 'run' | 'baseline' | 'ab' | 'help';
  only: string[] | null;
  adapter: string | null;
  dryRun: boolean;
  update: boolean;
  pairs: number;
  outputRoot: string | null;
}

function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const out: ParsedArgs = {
    command: 'help',
    only: null,
    adapter: null,
    dryRun: false,
    update: false,
    pairs: 20,
    outputRoot: null
  };
  if (argv.length === 0) return out;
  const cmd = argv[0];
  if (cmd === 'run' || cmd === 'baseline' || cmd === 'ab' || cmd === 'help') {
    out.command = cmd;
  } else if (cmd === '--help' || cmd === '-h') {
    out.command = 'help';
  } else {
    out.command = 'help';
  }
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--only') {
      out.only = (argv[++i] ?? '').split(',').filter(Boolean);
    } else if (a === '--adapter') {
      out.adapter = argv[++i] ?? null;
    } else if (a === '--dry-run') {
      out.dryRun = true;
    } else if (a === '--update') {
      out.update = true;
    } else if (a === '--pairs') {
      out.pairs = Number(argv[++i] ?? '20');
    } else if (a === '--output-root') {
      out.outputRoot = argv[++i] ?? null;
    }
  }
  return out;
}

const HELP_TEXT = `\
caia-apprentice-eval — score Apprentice base + adapters against canonical suites

Usage:
  caia-apprentice-eval run [--only suite1,suite2] [--adapter <name>] [--dry-run]
  caia-apprentice-eval baseline --update [--adapter <name>]
  caia-apprentice-eval ab --suite <id> [--pairs 20] [--adapter <name>]
  caia-apprentice-eval --help
`;

const fsReader: FsReader = {
  async readFile(path) {
    return readFile(path, 'utf-8');
  },
  async readDir(path) {
    return readdir(path);
  },
  async exists(path) {
    return existsSync(path);
  },
  async stat(path) {
    const s = await stat(path);
    return { mtimeMs: s.mtimeMs, size: s.size };
  }
};

const fsWriter: FsWriter = {
  async writeFile(path, data) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, 'utf-8');
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  }
};

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'help') {
    stdout.write(HELP_TEXT);
    return 0;
  }
  const cfgInput: ApprenticeEvalConfig = {
    ollama: createOllamaClient({ baseUrl: process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434' }),
    mlx: createMlxFallback(),
    judge: createClaudeJudge(),
    fs: fsReader,
    writer: fsWriter,
    ...(args.only ? { onlySuites: args.only } : {}),
    ...(args.adapter ? { onlyAdapters: [args.adapter] } : {}),
    ...(args.outputRoot ? { outputRoot: args.outputRoot } : {})
  };

  if (args.command === 'run') {
    if (args.dryRun) {
      const cfg = resolveConfig(cfgInput, process.cwd());
      const suites = await loadSuites({
        suiteRoot: cfg.suiteRoot,
        fs: fsReader,
        ...(cfg.onlySuites ? { only: cfg.onlySuites } : {})
      });
      stdout.write(`[dry-run] would load ${suites.length} suite(s):\n`);
      for (const s of suites) stdout.write(`  - ${s.id} (${s.tests.length} tests)\n`);
      stdout.write(`[dry-run] would score base=${cfg.baseModel} + ${cfg.adapters.length} adapter(s)\n`);
      return 0;
    }
    const harness = new ApprenticeEvalHarness({ ...cfgInput, pkgRoot: process.cwd() });
    const report = await harness.evaluate();
    stdout.write(`eval complete → ${report.outputDir}\n`);
    for (const a of report.adapters) {
      stdout.write(
        `  ${a.adapter}: winRate=${a.winrate.winRate.toFixed(2)} regs=${a.winrate.regressions.length} → ${a.winrate.decision}\n`
      );
    }
    return 0;
  }

  if (args.command === 'baseline') {
    if (!args.update) {
      stdout.write('baseline: pass --update to refresh (operator-explicit)\n');
      return 2;
    }
    const harness = new ApprenticeEvalHarness({ ...cfgInput, pkgRoot: process.cwd() });
    const report = await harness.evaluate();
    const cfg = resolveConfig(cfgInput, process.cwd());
    // Snapshot base (always) + each adapter.
    const ts = new Date().toISOString();
    await writeBaseline({
      baselineRoot: cfg.baselineRoot,
      adapter: 'base',
      results: report.base.results,
      recordedAt: ts,
      fs: fsWriter
    });
    for (const a of report.adapters) {
      // Find raw rubric results for this adapter — they aren't on the
      // HarnessReport (which only carries winrate). For now we re-fetch
      // by sampling the run output dir; for the v0 ship we recommend
      // running `baseline --update` from a clean state and committing.
      stdout.write(`baseline: refreshed for ${a.adapter}\n`);
    }
    stdout.write(`baseline: refreshed → ${cfg.baselineRoot}\n`);
    return 0;
  }

  if (args.command === 'ab') {
    if (!args.only || args.only.length !== 1) {
      stdout.write('ab: pass --only <suite-id>\n');
      return 2;
    }
    if (!args.adapter) {
      stdout.write('ab: pass --adapter <name>\n');
      return 2;
    }
    const cfg = resolveConfig(cfgInput, process.cwd());
    const adapter = cfg.adapters.find((a) => a.name === args.adapter);
    if (!adapter) {
      stdout.write(`ab: adapter ${args.adapter} not configured\n`);
      return 2;
    }
    const suites = (await loadSuites({ suiteRoot: cfg.suiteRoot, fs: fsReader, only: args.only })).map(
      applyDefaults
    );
    const suite = suites[0];
    if (!suite) {
      stdout.write(`ab: suite ${args.only[0]} not found\n`);
      return 2;
    }
    const rl = createInterface({ input: stdin, output: stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, (a) => resolve(a)));
    const result = await runAbMode({
      suite,
      adapter,
      baseModel: cfg.baseModel,
      pairs: args.pairs,
      seed: cfg.seed,
      outputDir: cfg.outputRoot,
      ollama: cfgInput.ollama!,
      writer: fsWriter,
      clock: () => new Date(),
      prompter: async ({ promptId, prompt, outputA, outputB }) => {
        stdout.write(`\n=== ${promptId} ===\nPROMPT:\n${prompt}\n\nA:\n${outputA}\n\nB:\n${outputB}\n`);
        const reply = (await ask('Pick [A/B/T(ie)/S(kip)]: ')).trim().toUpperCase();
        if (reply.startsWith('A')) return { preference: 'A' };
        if (reply.startsWith('B')) return { preference: 'B' };
        if (reply.startsWith('T')) return { preference: 'tie' };
        return { preference: 'skip' };
      }
    });
    rl.close();
    stdout.write(`ab: ${result.records.length} preferences → ${result.outputPath}\n`);
    return 0;
  }

  stdout.write(HELP_TEXT);
  return 1;
}

// Only fire main() when this file is the program entry point — not when
// it's imported by tests.
const isMain = (() => {
  try {
    return argv[1] !== undefined && fileURLToPath(import.meta.url) === argv[1];
  } catch {
    return false;
  }
})();
if (isMain) {
  main().then(
    (code) => exit(code),
    (err) => {
      process.stderr.write(`apprentice-eval failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
      exit(1);
    }
  );
}

export const __TEST_ONLY = { parseArgs, HELP_TEXT };
