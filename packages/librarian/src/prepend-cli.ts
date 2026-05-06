#!/usr/bin/env node
/**
 * caia-librarian-prepend — Librarian Phase-1 pre-spawn injection CLI.
 *
 * The orchestrator-facing CLI hook. Reads a prompt from stdin (or as a
 * positional arg), calls `prependPrecedent`, and emits the augmented
 * prompt to stdout. Exit code 0 always when the system is healthy
 * enough to attempt the call; exit code 2 on runtime failure (Ollama
 * unreachable, etc.).
 *
 * Recommended orchestrator integration (composes with mentor-prepend):
 *
 *     # bracket the new task with both lessons + precedent:
 *     AUGMENTED=$(echo "$ORIGINAL_PROMPT" | caia-mentor-prepend --quiet | caia-librarian-prepend --quiet)
 *     spawn-claude "$AUGMENTED"
 *
 * Or via the library: `import { prependPrecedent } from '@chiefaia/librarian'`.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_EMBED_MODEL, DEFAULT_OLLAMA_URL } from './embed.js';
import {
  prependPrecedent,
  type PrependPrecedentOptions,
  type PrependPrecedentResult
} from './prepend.js';
import { DEFAULT_MIN_SIMILARITY, DEFAULT_TOP_N } from './retrieve.js';
import { ALL_PRECEDENT_KINDS, isPrecedentKind, type PrecedentKind } from './types.js';

interface ParsedArgs {
  prompt: string | '__STDIN__' | '__HELP__';
  memoryDir: string;
  ollamaUrl: string;
  model: string;
  topN: number;
  threshold: number;
  kindFilter: PrecedentKind[] | undefined;
  failOnEmpty: boolean;
  metadata: boolean;
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
    stderr(`librarian-prepend: ${describeError(e)}`);
    stderr('run `caia-librarian-prepend --help` for usage');
    return exit(1);
  }

  if (parsed.prompt === '__HELP__') {
    stdout(usage());
    return exit(0);
  }

  let prompt: string;
  if (parsed.prompt === '__STDIN__') {
    const stdin = await readStdin();
    prompt = stdin;
    if (prompt.trim() === '') {
      stderr('librarian-prepend: stdin was empty');
      return exit(1);
    }
  } else {
    prompt = parsed.prompt;
  }

  try {
    const prependOpts: PrependPrecedentOptions = {
      memoryDir: parsed.memoryDir,
      ollamaUrl: parsed.ollamaUrl,
      embedModel: parsed.model,
      topN: parsed.topN,
      minSimilarity: parsed.threshold,
      warn: parsed.quiet ? () => undefined : (m: string) => stderr(m)
    };
    if (parsed.kindFilter !== undefined) prependOpts.kindFilter = parsed.kindFilter;

    const result = await prependPrecedent(prompt, prependOpts);

    if (!result.augmented && parsed.failOnEmpty) {
      stderr('librarian-prepend: no precedent matched and --fail-on-empty set');
      return exit(1);
    }

    stdout(result.augmentedPrompt);

    if (parsed.metadata) {
      stdout('');
      stdout('--- librarian-metadata ---');
      stdout(JSON.stringify(buildMetadata(result), null, 2));
    }

    return exit(0);
  } catch (e) {
    stderr(`librarian-prepend: ${describeError(e)}`);
    return exit(2);
  }
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  let prompt: string | null = null;
  let memoryDir = env['CAIA_MEMORY_DIR'];
  let ollamaUrl = env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL;
  let model = env['LIBRARIAN_EMBED_MODEL'] ?? DEFAULT_EMBED_MODEL;
  let topN = DEFAULT_TOP_N;
  let threshold = DEFAULT_MIN_SIMILARITY;
  let kindFilter: PrecedentKind[] | undefined;
  let failOnEmpty = false;
  let metadata = false;
  let quiet = false;
  let useStdin = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h' || arg === 'help') {
      return makeArgs({
        prompt: '__HELP__',
        memoryDir: '',
        ollamaUrl,
        model,
        topN,
        threshold,
        kindFilter,
        failOnEmpty,
        metadata,
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
    } else if (arg === '--fail-on-empty') {
      failOnEmpty = true;
    } else if (arg === '--emit-empty') {
      // explicit no-op; default behavior
    } else if (arg === '--metadata') {
      metadata = true;
    } else if (arg === '--quiet') {
      quiet = true;
    } else if (arg === '--stdin') {
      useStdin = true;
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`unknown flag ${JSON.stringify(arg)}`);
    } else if (arg !== undefined) {
      if (prompt !== null) {
        throw new Error('only one positional prompt argument is allowed');
      }
      prompt = arg;
    }
  }

  if (memoryDir === undefined || memoryDir === '') {
    memoryDir = join(homedir(), 'Documents', 'projects', 'caia', 'agent', 'memory');
  }
  if (useStdin && prompt !== null) {
    throw new Error('cannot pass both --stdin and a positional prompt');
  }
  if (prompt === null) {
    prompt = '__STDIN__';
  }

  return makeArgs({
    prompt,
    memoryDir,
    ollamaUrl,
    model,
    topN,
    threshold,
    kindFilter,
    failOnEmpty,
    metadata,
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
  prompt: string;
  memoryDir: string;
  ollamaUrl: string;
  model: string;
  topN: number;
  threshold: number;
  kindFilter: PrecedentKind[] | undefined;
  failOnEmpty: boolean;
  metadata: boolean;
  quiet: boolean;
}): ParsedArgs {
  return {
    prompt: p.prompt as ParsedArgs['prompt'],
    memoryDir: p.memoryDir,
    ollamaUrl: p.ollamaUrl,
    model: p.model,
    topN: p.topN,
    threshold: p.threshold,
    kindFilter: p.kindFilter,
    failOnEmpty: p.failOnEmpty,
    metadata: p.metadata,
    quiet: p.quiet
  };
}

interface PrependMetadata {
  augmented: boolean;
  preambleLength: number;
  precedentCount: number;
  precedent: Array<{
    slug: string;
    kind: PrecedentKind;
    similarity: number;
    path: string;
  }>;
}

function buildMetadata(r: PrependPrecedentResult): PrependMetadata {
  return {
    augmented: r.augmented,
    preambleLength: r.preambleLength,
    precedentCount: r.precedent.length,
    precedent: r.precedent.map((p) => ({
      slug: p.slug,
      kind: p.kind,
      similarity: p.similarity,
      path: p.path
    }))
  };
}

function usage(): string {
  return `caia-librarian-prepend — pre-spawn precedent injection (Librarian Phase 1)

Usage:
  echo "<prompt>" | caia-librarian-prepend [flags]
  caia-librarian-prepend "<prompt>" [flags]
  caia-librarian-prepend --stdin [flags] < prompt.txt

Flags:
  --memory <path>     Memory dir (default: $CAIA_MEMORY_DIR)
  --ollama <url>      Ollama URL (default: ${DEFAULT_OLLAMA_URL})
  --model <name>      Embedding model (default: ${DEFAULT_EMBED_MODEL})
  --top-n <int>       Top N precedent (default: ${DEFAULT_TOP_N})
  --threshold <num>   Minimum similarity (default: ${DEFAULT_MIN_SIMILARITY})
  --kind <a,b,c>      Filter comma-separated kinds (e.g. directive,report)
  --metadata          Append --- librarian-metadata --- JSON footer
  --fail-on-empty     Exit 1 if no precedent matched
  --quiet             Suppress warnings
  --help, -h          Show this help

Reads prompt from stdin if no positional argument.

Composes with @chiefaia/mentor-retrieval's caia-mentor-prepend in either order:
  echo "$P" | caia-mentor-prepend | caia-librarian-prepend
  echo "$P" | caia-librarian-prepend | caia-mentor-prepend
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
    process.stderr.write(`librarian-prepend: fatal: ${describeError(e)}\n`);
    process.exit(2);
  });
}
