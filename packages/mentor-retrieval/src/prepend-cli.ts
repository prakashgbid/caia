#!/usr/bin/env node
/**
 * caia-mentor-prepend — Mentor Phase-3 PR-3 CLI.
 *
 * The orchestrator-facing CLI hook. Reads a prompt from stdin (or as a
 * positional arg), calls `prependLessons`, and emits the augmented
 * prompt to stdout. Exit code 0 always when the system is healthy
 * enough to attempt the call; exit code 2 on runtime failure (Ollama
 * unreachable, etc.).
 *
 * Recommended orchestrator integration:
 *
 *     # Orchestrator's spawn pipeline:
 *     AUGMENTED=$(echo "$ORIGINAL_PROMPT" | caia-mentor-prepend --quiet)
 *     spawn-claude "$AUGMENTED"
 *
 * Or via the library: `import { prependLessons } from
 * '@chiefaia/mentor-retrieval'`.
 *
 * Flags:
 *
 *   --memory <path>     Override $CAIA_MEMORY_DIR.
 *   --ollama <url>      Override $OLLAMA_URL.
 *   --model <name>      Override $MENTOR_EMBED_MODEL.
 *   --top-n <int>       Top N lessons. Default: 5.
 *   --threshold <num>   Minimum cosine similarity. Default: 0.4.
 *   --kind <kind>       Filter to feedback or proposal.
 *   --emit-empty        Emit the original prompt even if no lessons match.
 *                       (Default behavior; included for symmetry.)
 *   --fail-on-empty     Exit 1 if no lessons matched (for orchestrators
 *                       that want to assert at least one lesson was
 *                       attached, e.g. for high-stakes tasks).
 *   --metadata          Append a `--- mentor-metadata ---` JSON footer
 *                       describing what was attached. Useful for
 *                       audit-trail logging.
 *   --quiet             Suppress warnings to stderr.
 *
 * Always reads from stdin unless a positional arg is provided.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_EMBED_MODEL, DEFAULT_OLLAMA_URL } from './embed.js';
import {
  prependLessons,
  type PrependLessonsOptions,
  type PrependLessonsResult
} from './prepend.js';
import { DEFAULT_MIN_SIMILARITY, DEFAULT_TOP_N } from './retrieve.js';
import type { LessonKind } from './types.js';

interface ParsedArgs {
  prompt: string | '__STDIN__' | '__HELP__';
  memoryDir: string;
  ollamaUrl: string;
  model: string;
  topN: number;
  threshold: number;
  kindFilter: LessonKind | undefined;
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
    stderr(`mentor-prepend: ${describeError(e)}`);
    stderr('run `caia-mentor-prepend --help` for usage');
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
      stderr('mentor-prepend: stdin was empty');
      return exit(1);
    }
  } else {
    prompt = parsed.prompt;
  }

  try {
    const prependOpts: PrependLessonsOptions = {
      memoryDir: parsed.memoryDir,
      ollamaUrl: parsed.ollamaUrl,
      embedModel: parsed.model,
      topN: parsed.topN,
      minSimilarity: parsed.threshold,
      warn: parsed.quiet ? () => undefined : (m: string) => stderr(m)
    };
    if (parsed.kindFilter !== undefined) prependOpts.kindFilter = parsed.kindFilter;

    const result = await prependLessons(prompt, prependOpts);

    if (!result.augmented && parsed.failOnEmpty) {
      stderr('mentor-prepend: no lessons matched and --fail-on-empty set');
      return exit(1);
    }

    stdout(result.augmentedPrompt);

    if (parsed.metadata) {
      stdout('');
      stdout('--- mentor-metadata ---');
      stdout(JSON.stringify(buildMetadata(result), null, 2));
    }

    return exit(0);
  } catch (e) {
    stderr(`mentor-prepend: ${describeError(e)}`);
    return exit(2);
  }
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  let prompt: string | null = null;
  let memoryDir = env['CAIA_MEMORY_DIR'];
  let ollamaUrl = env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL;
  let model = env['MENTOR_EMBED_MODEL'] ?? DEFAULT_EMBED_MODEL;
  let topN = DEFAULT_TOP_N;
  let threshold = DEFAULT_MIN_SIMILARITY;
  let kindFilter: LessonKind | undefined;
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
      if (v !== 'feedback' && v !== 'proposal') {
        throw new Error(
          `--kind must be one of feedback|proposal (got ${String(v)})`
        );
      }
      kindFilter = v;
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

  // Default to stdin when no positional + no explicit --stdin (the
  // expected orchestrator pipeline pattern is `echo $P | mentor-prepend`).
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

function makeArgs(p: {
  prompt: string;
  memoryDir: string;
  ollamaUrl: string;
  model: string;
  topN: number;
  threshold: number;
  kindFilter: LessonKind | undefined;
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
  lessonCount: number;
  lessons: Array<{
    slug: string;
    kind: LessonKind;
    similarity: number;
    path: string;
  }>;
}

function buildMetadata(r: PrependLessonsResult): PrependMetadata {
  return {
    augmented: r.augmented,
    preambleLength: r.preambleLength,
    lessonCount: r.lessons.length,
    lessons: r.lessons.map((l) => ({
      slug: l.slug,
      kind: l.kind,
      similarity: l.similarity,
      path: l.path
    }))
  };
}

function usage(): string {
  return `caia-mentor-prepend — pre-spawn lesson injection (Mentor Phase 3 PR-3)

Usage:
  echo "<prompt>" | caia-mentor-prepend [flags]
  caia-mentor-prepend "<prompt>" [flags]
  caia-mentor-prepend --stdin [flags] < prompt.txt

Flags:
  --memory <path>     Memory dir (default: $CAIA_MEMORY_DIR)
  --ollama <url>      Ollama URL (default: ${DEFAULT_OLLAMA_URL})
  --model <name>      Embedding model (default: ${DEFAULT_EMBED_MODEL})
  --top-n <int>       Top N lessons (default: ${DEFAULT_TOP_N})
  --threshold <num>   Minimum similarity (default: ${DEFAULT_MIN_SIMILARITY})
  --kind <kind>       Filter feedback or proposal
  --metadata          Append --- mentor-metadata --- JSON footer
  --fail-on-empty     Exit 1 if no lessons matched
  --quiet             Suppress warnings
  --help, -h          Show this help

Reads prompt from stdin if no positional argument.
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
    process.stderr.write(`mentor-prepend: fatal: ${describeError(e)}\n`);
    process.exit(2);
  });
}
