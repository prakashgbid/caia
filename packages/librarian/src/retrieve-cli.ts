#!/usr/bin/env node
/**
 * caia-librarian-retrieve — Librarian Phase-1 query CLI.
 *
 * Reads a query from stdin (or the positional argument) and prints the
 * top-N matching precedent rows in human-readable form. Exit 0 always
 * when the system is healthy enough to attempt the query; exit 2 on
 * runtime failure (Ollama unreachable, etc.).
 *
 * Output modes:
 *
 *   default  — Tab-separated `<similarity>\t<kind>\t<slug>\t<path>` per line.
 *   --json   — Single JSON document containing the full result list.
 *   --pretty — Multi-line block per row including the snippet.
 *
 * Flags mirror the prepend CLI where they make sense.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_EMBED_MODEL, DEFAULT_OLLAMA_URL, createOllamaEmbedder } from './embed.js';
import {
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_TOP_N,
  formatPrecedentPreamble,
  retrievePrecedent,
  type RetrievedPrecedent
} from './retrieve.js';
import { defaultReportsDir } from './source-readers.js';
import { ALL_PRECEDENT_KINDS, isPrecedentKind, type PrecedentKind } from './types.js';

type OutputMode = 'tsv' | 'json' | 'pretty' | 'preamble';

interface ParsedArgs {
  query: string | '__STDIN__' | '__HELP__';
  memoryDir: string;
  ollamaUrl: string;
  model: string;
  topN: number;
  threshold: number;
  kindFilter: PrecedentKind[] | undefined;
  output: OutputMode;
  quiet: boolean;
}

interface RunOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  exit?: (code: number) => never;
  readStdin?: () => Promise<string>;
}

export async function main(opts: RunOptions = {}): Promise<void> {
  const argv = opts.argv ?? process.argv.slice(2);
  const env = opts.env ?? process.env;
  const stdout = opts.stdout ?? ((s: string) => process.stdout.write(`${s}\n`));
  const stderr = opts.stderr ?? ((s: string) => process.stderr.write(`${s}\n`));
  const exit =
    opts.exit ??
    ((code: number) => {
      process.exit(code);
    });
  const readStdin = opts.readStdin ?? defaultReadStdin;

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, env);
  } catch (e) {
    stderr(`librarian-retrieve: ${describeError(e)}`);
    stderr('run `caia-librarian-retrieve --help` for usage');
    return exit(1);
  }

  if (parsed.query === '__HELP__') {
    stdout(usage());
    return exit(0);
  }

  let query: string;
  if (parsed.query === '__STDIN__') {
    const stdin = await readStdin();
    query = stdin;
    if (query.trim() === '') {
      stderr('librarian-retrieve: stdin was empty');
      return exit(1);
    }
  } else {
    query = parsed.query;
  }

  try {
    const embedder = createOllamaEmbedder({
      url: parsed.ollamaUrl,
      model: parsed.model
    });
    const retrieveOpts: Parameters<typeof retrievePrecedent>[1] = {
      memoryDir: parsed.memoryDir,
      embed: embedder,
      topN: parsed.topN,
      minSimilarity: parsed.threshold,
      warn: parsed.quiet ? () => undefined : (m: string) => stderr(m)
    };
    if (parsed.kindFilter !== undefined) retrieveOpts.kindFilter = parsed.kindFilter;

    // unused after this branch — reference for keeping dependencies
    void defaultReportsDir; // for tree-shake survival in some bundlers

    const results = await retrievePrecedent(query, retrieveOpts);
    emitResults(results, parsed.output, stdout);
    return exit(0);
  } catch (e) {
    stderr(`librarian-retrieve: ${describeError(e)}`);
    return exit(2);
  }
}

function emitResults(
  results: RetrievedPrecedent[],
  output: OutputMode,
  stdout: (s: string) => void
): void {
  if (output === 'json') {
    stdout(JSON.stringify(results, null, 2));
    return;
  }
  if (output === 'preamble') {
    stdout(formatPrecedentPreamble(results));
    return;
  }
  if (output === 'pretty') {
    if (results.length === 0) {
      stdout('(no precedent above threshold)');
      return;
    }
    results.forEach((r, i) => {
      stdout(`${i + 1}. ${r.slug}  (kind=${r.kind}, similarity=${r.similarity.toFixed(3)})`);
      stdout(`   path: ${r.path}`);
      const lines = r.snippet.split('\n').filter((l) => l.trim() !== '').slice(0, 6);
      for (const line of lines) {
        stdout(`   | ${line}`);
      }
      stdout('');
    });
    return;
  }
  // default tsv
  if (results.length === 0) {
    return;
  }
  for (const r of results) {
    stdout(
      `${r.similarity.toFixed(3)}\t${r.kind}\t${r.slug}\t${r.path}`
    );
  }
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  let query: string | null = null;
  let memoryDir = env['CAIA_MEMORY_DIR'];
  let ollamaUrl = env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL;
  let model = env['LIBRARIAN_EMBED_MODEL'] ?? DEFAULT_EMBED_MODEL;
  let topN = DEFAULT_TOP_N;
  let threshold = DEFAULT_MIN_SIMILARITY;
  let kindFilter: PrecedentKind[] | undefined;
  let output: OutputMode = 'tsv';
  let quiet = false;
  let useStdin = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      return makeArgs({
        query: '__HELP__',
        memoryDir: '',
        ollamaUrl,
        model,
        topN,
        threshold,
        kindFilter,
        output,
        quiet
      });
    }
    if (arg === '--memory') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--memory requires a value');
      memoryDir = v;
    } else if (arg === '--ollama') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--ollama requires a value');
      ollamaUrl = v;
    } else if (arg === '--model') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--model requires a value');
      model = v;
    } else if (arg === '--top-n') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--top-n requires a value');
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--top-n must be a positive integer (got ${v})`);
      }
      topN = n;
    } else if (arg === '--threshold') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--threshold requires a value');
      const n = Number(v);
      if (!Number.isFinite(n)) {
        throw new Error(`--threshold must be a number (got ${v})`);
      }
      threshold = n;
    } else if (arg === '--kind') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--kind requires a value');
      kindFilter = parseKindList(v);
    } else if (arg === '--json') {
      output = 'json';
    } else if (arg === '--pretty') {
      output = 'pretty';
    } else if (arg === '--preamble') {
      output = 'preamble';
    } else if (arg === '--quiet') {
      quiet = true;
    } else if (arg === '--stdin') {
      useStdin = true;
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`unknown flag ${JSON.stringify(arg)}`);
    } else if (arg !== undefined) {
      if (query !== null) {
        throw new Error('only one positional query argument is allowed');
      }
      query = arg;
    }
  }

  if (memoryDir === undefined || memoryDir === '') {
    memoryDir = join(homedir(), 'Documents', 'projects', 'caia', 'agent', 'memory');
  }
  if (useStdin && query !== null) {
    throw new Error('cannot pass both --stdin and a positional query');
  }
  if (query === null) {
    query = '__STDIN__';
  }

  return makeArgs({
    query,
    memoryDir,
    ollamaUrl,
    model,
    topN,
    threshold,
    kindFilter,
    output,
    quiet
  });
}

function parseKindList(v: string): PrecedentKind[] {
  const parts = v.split(',').map((s) => s.trim()).filter((s) => s !== '');
  if (parts.length === 0) {
    throw new Error('--kind requires at least one kind');
  }
  for (const p of parts) {
    if (!isPrecedentKind(p)) {
      throw new Error(
        `--kind got unknown kind ${JSON.stringify(p)}; valid: ${ALL_PRECEDENT_KINDS.join(',')}`
      );
    }
  }
  return parts as PrecedentKind[];
}

function makeArgs(p: {
  query: string;
  memoryDir: string;
  ollamaUrl: string;
  model: string;
  topN: number;
  threshold: number;
  kindFilter: PrecedentKind[] | undefined;
  output: OutputMode;
  quiet: boolean;
}): ParsedArgs {
  return {
    query: p.query as ParsedArgs['query'],
    memoryDir: p.memoryDir,
    ollamaUrl: p.ollamaUrl,
    model: p.model,
    topN: p.topN,
    threshold: p.threshold,
    kindFilter: p.kindFilter,
    output: p.output,
    quiet: p.quiet
  };
}

function usage(): string {
  return `caia-librarian-retrieve — Librarian Phase-1 query CLI

Usage:
  echo "<query>" | caia-librarian-retrieve [flags]
  caia-librarian-retrieve "<query>" [flags]
  caia-librarian-retrieve --stdin [flags] < query.txt

Flags:
  --memory <path>     Memory dir (default: $CAIA_MEMORY_DIR)
  --ollama <url>      Ollama URL (default: ${DEFAULT_OLLAMA_URL})
  --model <name>      Embedding model (default: ${DEFAULT_EMBED_MODEL})
  --top-n <int>       Top N results (default: ${DEFAULT_TOP_N})
  --threshold <num>   Minimum similarity (default: ${DEFAULT_MIN_SIMILARITY})
  --kind <a,b,c>      Filter to comma-separated kinds (e.g. directive,report)
  --json              Emit JSON document
  --pretty            Emit human-readable multi-line block
  --preamble          Emit the same preamble caia-librarian-prepend would inject
  --quiet             Suppress warnings
  --help, -h          Show this help

Reads query from stdin if no positional argument.
`;
}

async function defaultReadStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

const isMain = (): boolean => {
  const meta = import.meta.url;
  if (!meta.startsWith('file://')) return false;
  const arg1 = process.argv[1];
  if (arg1 === undefined) return false;
  return meta.endsWith(arg1) || meta === `file://${arg1}`;
};

if (isMain()) {
  main().catch((e) => {
    process.stderr.write(`librarian-retrieve: fatal: ${describeError(e)}\n`);
    process.exit(2);
  });
}
