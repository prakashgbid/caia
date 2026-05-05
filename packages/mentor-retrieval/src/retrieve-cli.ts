#!/usr/bin/env node
/**
 * caia-mentor-retrieve — Mentor Phase-3 PR-2 CLI.
 *
 * Reads a prompt (positional argument or stdin), embeds it via Ollama,
 * scans the index DB for the top-N most similar past lessons, and
 * prints either the human-readable preamble (default) or JSON.
 *
 * Usage:
 *
 *   caia-mentor-retrieve "<prompt text>"
 *   echo "<prompt>" | caia-mentor-retrieve --stdin
 *   caia-mentor-retrieve --stdin < some-task-brief.md
 *
 * Flags:
 *
 *   --memory <path>     Override the memory directory.
 *   --ollama <url>      Override the Ollama URL.
 *   --model <name>      Override the embedding model.
 *   --top-n <int>       Top N to return. Default 5.
 *   --threshold <num>   Minimum cosine similarity. Default 0.4.
 *   --kind <feedback|proposal>
 *                       Optional kind filter.
 *   --format <text|json|prepend>
 *                       Output format. Default: text.
 *                         text    — human-readable list
 *                         json    — array of objects
 *                         prepend — preamble + 2 newlines + the original
 *                                   prompt (the literal text the
 *                                   orchestrator hook will use)
 *   --stdin             Read prompt from stdin instead of argv.
 *   --quiet             Suppress warnings to stderr.
 *
 * Exit codes:
 *
 *   0   — success (including the "no lessons found" graceful path)
 *   1   — usage error
 *   2   — runtime failure
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_EMBED_MODEL, DEFAULT_OLLAMA_URL, createOllamaEmbedder } from './embed.js';
import {
  DEFAULT_MIN_SIMILARITY,
  DEFAULT_TOP_N,
  formatLessonsPreamble,
  retrieveLessons,
  type RetrievedLesson
} from './retrieve.js';
import type { LessonKind } from './types.js';

interface ParsedArgs {
  prompt: string;
  memoryDir: string;
  ollamaUrl: string;
  model: string;
  topN: number;
  threshold: number;
  format: 'text' | 'json' | 'prepend';
  kindFilter: LessonKind | undefined;
  quiet: boolean;
}

interface RunOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  exit?: (code: number) => never;
  /** Read all of stdin as a string. Tests inject a fake. */
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
    const intermediate = parseArgs(argv, env);
    if (intermediate.prompt === '__STDIN__') {
      const stdin = await readStdin();
      intermediate.prompt = stdin.trim();
      if (intermediate.prompt === '') {
        stderr('mentor-retrieve: stdin was empty');
        return exit(1);
      }
    }
    parsed = intermediate;
  } catch (e) {
    stderr(`mentor-retrieve: ${describeError(e)}`);
    stderr('run `caia-mentor-retrieve --help` for usage');
    return exit(1);
  }

  if (parsed.prompt === '__HELP__') {
    stdout(usage());
    return exit(0);
  }

  try {
    const embedder = createOllamaEmbedder({
      url: parsed.ollamaUrl,
      model: parsed.model
    });
    const retrieveOpts: Parameters<typeof retrieveLessons>[1] = {
      memoryDir: parsed.memoryDir,
      embed: embedder,
      topN: parsed.topN,
      minSimilarity: parsed.threshold,
      warn: parsed.quiet ? () => undefined : (m: string) => stderr(m)
    };
    if (parsed.kindFilter !== undefined) {
      retrieveOpts.kindFilter = parsed.kindFilter;
    }
    const lessons = await retrieveLessons(parsed.prompt, retrieveOpts);
    stdout(renderOutput(lessons, parsed.format, parsed.prompt));
    return exit(0);
  } catch (e) {
    stderr(`mentor-retrieve: ${describeError(e)}`);
    return exit(2);
  }
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  let prompt: string | null = null;
  let memoryDir: string | undefined = env['CAIA_MEMORY_DIR'];
  let ollamaUrl = env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL;
  let model = env['MENTOR_EMBED_MODEL'] ?? DEFAULT_EMBED_MODEL;
  let topN = DEFAULT_TOP_N;
  let threshold = DEFAULT_MIN_SIMILARITY;
  let format: 'text' | 'json' | 'prepend' = 'text';
  let kindFilter: LessonKind | undefined;
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
        format,
        kindFilter,
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
    } else if (arg === '--format') {
      i++;
      const v = argv[i];
      if (v !== 'text' && v !== 'json' && v !== 'prepend') {
        throw new Error(
          `--format must be one of text|json|prepend (got ${String(v)})`
        );
      }
      format = v;
    } else if (arg === '--kind') {
      i++;
      const v = argv[i];
      if (v !== 'feedback' && v !== 'proposal') {
        throw new Error(
          `--kind must be one of feedback|proposal (got ${String(v)})`
        );
      }
      kindFilter = v;
    } else if (arg === '--stdin') {
      useStdin = true;
    } else if (arg === '--quiet') {
      quiet = true;
    } else if (arg !== undefined && arg.startsWith('--')) {
      throw new Error(`unknown flag ${JSON.stringify(arg)}`);
    } else if (arg !== undefined) {
      // Positional prompt argument. Only one allowed.
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
  if (useStdin) {
    prompt = '__STDIN__';
  }
  if (prompt === null) {
    throw new Error(
      'no prompt provided; pass a positional arg or --stdin'
    );
  }

  return makeArgs({
    prompt,
    memoryDir,
    ollamaUrl,
    model,
    topN,
    threshold,
    format,
    kindFilter,
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
  format: 'text' | 'json' | 'prepend';
  kindFilter: LessonKind | undefined;
  quiet: boolean;
}): ParsedArgs {
  // Build incrementally so kindFilter=undefined works under
  // exactOptionalPropertyTypes.
  const out: ParsedArgs = {
    prompt: p.prompt,
    memoryDir: p.memoryDir,
    ollamaUrl: p.ollamaUrl,
    model: p.model,
    topN: p.topN,
    threshold: p.threshold,
    format: p.format,
    kindFilter: p.kindFilter,
    quiet: p.quiet
  };
  return out;
}

function renderOutput(
  lessons: RetrievedLesson[],
  format: 'text' | 'json' | 'prepend',
  prompt: string
): string {
  if (format === 'json') {
    return JSON.stringify(
      lessons.map((l) => ({
        path: l.path,
        kind: l.kind,
        slug: l.slug,
        similarity: l.similarity,
        snippet: l.snippet,
        mtimeMs: l.mtimeMs
      })),
      null,
      2
    );
  }
  if (format === 'prepend') {
    const preamble = formatLessonsPreamble(lessons);
    if (preamble === '') return prompt;
    return `${preamble}\n${prompt}`;
  }
  // text
  if (lessons.length === 0) {
    return '(no relevant lessons found above the similarity threshold)';
  }
  return formatLessonsPreamble(lessons);
}

function usage(): string {
  return `caia-mentor-retrieve — query the Mentor Phase-3 lesson index

Usage:
  caia-mentor-retrieve "<prompt>" [flags]
  caia-mentor-retrieve --stdin [flags] < prompt.txt

Flags:
  --memory <path>     Memory directory containing _mentor-index.sqlite
                      (default: $CAIA_MEMORY_DIR or ~/Documents/projects/caia/agent/memory)
  --ollama <url>      Ollama HTTP URL (default: ${DEFAULT_OLLAMA_URL})
  --model <name>      Embedding model (default: ${DEFAULT_EMBED_MODEL})
  --top-n <int>       Top N results (default: ${DEFAULT_TOP_N})
  --threshold <num>   Minimum cosine similarity (default: ${DEFAULT_MIN_SIMILARITY})
  --kind <kind>       Filter by kind: feedback or proposal
  --format <fmt>      Output format: text (default) | json | prepend
  --stdin             Read prompt from stdin
  --quiet             Suppress warnings
  --help, -h          Show this help
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
    process.stderr.write(`mentor-retrieve: fatal: ${describeError(e)}\n`);
    process.exit(2);
  });
}
