#!/usr/bin/env node
/**
 * caia-mentor-index — Mentor Phase-3 PR-1 CLI.
 *
 * Subcommands:
 *
 *   build   — Read all feedback_*.md + proposals/*.md under the memory
 *             dir, embed each via Ollama, write/update the index DB at
 *             `<memoryDir>/_mentor-index.sqlite`. Idempotent; only
 *             re-embeds files whose mtime + sha256 changed.
 *
 *   status  — Print the current index summary (rows by kind, last build
 *             time, embedding model + dim) without modifying anything.
 *
 *   help    — Print usage and exit 0.
 *
 * Flags:
 *
 *   --memory   <path>   Override the memory directory. Default:
 *                       $CAIA_MEMORY_DIR or process.cwd()/agent/memory.
 *   --ollama   <url>    Override the Ollama base URL. Default:
 *                       $OLLAMA_URL or http://127.0.0.1:11434.
 *   --model    <name>   Override the embedding model. Default:
 *                       $MENTOR_EMBED_MODEL or nomic-embed-text.
 *   --quiet             Suppress per-file progress.
 *
 * Exit codes:
 *
 *   0   — success
 *   1   — usage error / unknown subcommand
 *   2   — runtime failure (couldn't reach Ollama, couldn't open DB, etc.)
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_EMBED_MODEL,
  DEFAULT_OLLAMA_URL,
  createOllamaEmbedder
} from './embed.js';
import { buildIndex } from './index-builder.js';
import { openIndexStore } from './index-store.js';

interface ParsedArgs {
  subcommand: 'build' | 'status' | 'help';
  memoryDir: string;
  ollamaUrl: string;
  model: string;
  quiet: boolean;
}

interface RunOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  exit?: (code: number) => never;
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

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, env);
  } catch (e) {
    stderr(`mentor-index: ${describeError(e)}`);
    stderr('run `caia-mentor-index help` for usage');
    return exit(1);
  }

  if (parsed.subcommand === 'help') {
    stdout(usage());
    return exit(0);
  }

  if (parsed.subcommand === 'build') {
    try {
      const embedder = createOllamaEmbedder({
        url: parsed.ollamaUrl,
        model: parsed.model
      });
      const stats = await buildIndex({
        memoryDir: parsed.memoryDir,
        embed: embedder,
        log: parsed.quiet ? () => undefined : (m: string) => stderr(m)
      });
      stdout(JSON.stringify(stats, null, 2));
      return exit(0);
    } catch (e) {
      stderr(`mentor-index build failed: ${describeError(e)}`);
      return exit(2);
    }
  }

  // status
  try {
    const store = openIndexStore({
      memoryDir: parsed.memoryDir,
      readonly: true
    });
    try {
      const all = store.listAll();
      const byKind: Record<string, number> = {};
      for (const r of all) {
        byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      }
      const summary = {
        indexPath: store.dbPath,
        totalRows: all.length,
        byKind,
        embeddingModel: store.getMeta('embedding_model'),
        embeddingDim: numberOrNull(store.getMeta('embedding_dim')),
        lastBuildAtMs: numberOrNull(store.getMeta('last_build_at_ms')),
        lastBuildAtIso: isoOrNull(store.getMeta('last_build_at_ms')),
        lastBuildScanned: numberOrNull(store.getMeta('last_build_scanned'))
      };
      stdout(JSON.stringify(summary, null, 2));
      return exit(0);
    } finally {
      store.close();
    }
  } catch (e) {
    // No DB yet -> graceful "not built" output, exit 0 so cron-style
    // wrappers can keep going.
    if (!existsSync(join(parsed.memoryDir, '_mentor-index.sqlite'))) {
      const empty = {
        indexPath: join(parsed.memoryDir, '_mentor-index.sqlite'),
        totalRows: 0,
        byKind: {},
        embeddingModel: null,
        embeddingDim: null,
        lastBuildAtMs: null,
        lastBuildAtIso: null,
        lastBuildScanned: null,
        note: 'index not built yet — run `caia-mentor-index build`'
      };
      stdout(JSON.stringify(empty, null, 2));
      return exit(0);
    }
    stderr(`mentor-index status failed: ${describeError(e)}`);
    return exit(2);
  }
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  if (argv.length === 0) {
    throw new Error('missing subcommand (build|status|help)');
  }
  const sub = argv[0];
  if (sub !== 'build' && sub !== 'status' && sub !== 'help') {
    throw new Error(
      `unknown subcommand ${JSON.stringify(sub)}; expected build|status|help`
    );
  }

  let memoryDir = env['CAIA_MEMORY_DIR'];
  let ollamaUrl = env['OLLAMA_URL'] ?? DEFAULT_OLLAMA_URL;
  let model = env['MENTOR_EMBED_MODEL'] ?? DEFAULT_EMBED_MODEL;
  let quiet = false;

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
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
    } else if (arg === '--quiet') {
      quiet = true;
    } else {
      throw new Error(`unknown flag ${JSON.stringify(arg)}`);
    }
  }

  if (memoryDir === undefined || memoryDir === '') {
    memoryDir = join(homedir(), 'Documents', 'projects', 'caia', 'agent', 'memory');
  }

  return {
    subcommand: sub,
    memoryDir,
    ollamaUrl,
    model,
    quiet
  };
}

function usage(): string {
  return `caia-mentor-index — Mentor Phase-3 lesson-index builder + status

Usage:
  caia-mentor-index build [--memory <dir>] [--ollama <url>] [--model <name>] [--quiet]
  caia-mentor-index status [--memory <dir>]
  caia-mentor-index help

Environment:
  CAIA_MEMORY_DIR       Memory directory containing feedback_*.md + proposals/*.md
  OLLAMA_URL            Ollama HTTP base URL (default: ${DEFAULT_OLLAMA_URL})
  MENTOR_EMBED_MODEL    Embedding model (default: ${DEFAULT_EMBED_MODEL})
`;
}

function numberOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(v: string | null): string | null {
  const n = numberOrNull(v);
  if (n === null) return null;
  return new Date(n).toISOString();
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
  // Compare resolved file paths (handles both `node dist/cli.js` and
  // bin-shim invocations).
  return meta.endsWith(arg1) || meta === `file://${arg1}`;
};

if (isMain()) {
  main().catch((e) => {
    process.stderr.write(`mentor-index: fatal: ${describeError(e)}\n`);
    process.exit(2);
  });
}
