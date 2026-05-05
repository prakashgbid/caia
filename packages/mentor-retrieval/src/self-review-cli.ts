#!/usr/bin/env node
/**
 * caia-mentor-self-review — Mentor Phase-4 PR-3 CLI.
 *
 * Subcommands:
 *
 *   run    — Compute a self-review snapshot from the index DB and
 *            emit it as markdown (default) or JSON. Can write to a
 *            file via `--output`.
 *
 *   help   — Print usage and exit 0.
 *
 * Flags:
 *
 *   --memory       <path>      Override the memory dir (default $CAIA_MEMORY_DIR).
 *   --window-days  <N>         Rolling window size in days (default 90).
 *   --top-n        <N>         Number of top systemic clusters to
 *                              highlight (default 10).
 *   --output       <path>      Write the report to this path instead
 *                              of stdout. Parent dir must exist.
 *   --format       <md|json>   Output format. Default: md.
 *
 * Exit codes:
 *
 *   0   — success
 *   1   — usage error
 *   2   — runtime failure (no index DB, write failure, ...)
 */

import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { openIndexStore } from './index-store.js';
import {
  DEFAULT_TOP_CLUSTERS,
  DEFAULT_WINDOW_DAYS,
  generateSelfReview,
  renderSelfReviewMarkdown,
  type SelfReviewMetaInput,
  type SelfReviewSnapshot
} from './self-review.js';

interface ParsedArgs {
  subcommand: 'run' | 'help';
  memoryDir: string;
  windowDays: number;
  topN: number;
  outputPath: string | null;
  format: 'md' | 'json';
}

interface RunOptions {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  stdout?: (s: string) => void;
  stderr?: (s: string) => void;
  exit?: (code: number) => never;
  nowMs?: number;
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
    stderr(`mentor-self-review: ${describeError(e)}`);
    stderr('run `caia-mentor-self-review help` for usage');
    return exit(1);
  }

  if (parsed.subcommand === 'help') {
    stdout(usage());
    return exit(0);
  }

  // run
  const dbPath = join(parsed.memoryDir, '_mentor-index.sqlite');
  if (!existsSync(dbPath)) {
    stderr(
      `mentor-self-review: no index DB at ${dbPath}; run \`caia-mentor-index build\` first`
    );
    return exit(2);
  }

  let snapshot: SelfReviewSnapshot;
  try {
    const store = openIndexStore({ memoryDir: parsed.memoryDir, readonly: true });
    try {
      const lessons = store.listAll();
      const meta: SelfReviewMetaInput = {
        embeddingModel: store.getMeta('embedding_model'),
        embeddingDim: numberOrNull(store.getMeta('embedding_dim')),
        lastBuildAtMs: numberOrNull(store.getMeta('last_build_at_ms')),
        lastBuildScanned: numberOrNull(store.getMeta('last_build_scanned'))
      };
      const reviewOpts: Parameters<typeof generateSelfReview>[1] = {
        windowDays: parsed.windowDays,
        topClustersToHighlight: parsed.topN,
        memoryDir: parsed.memoryDir,
        meta
      };
      if (opts.nowMs !== undefined) reviewOpts.nowMs = opts.nowMs;
      snapshot = generateSelfReview(lessons, reviewOpts);
    } finally {
      store.close();
    }
  } catch (e) {
    stderr(`mentor-self-review: failed to read index: ${describeError(e)}`);
    return exit(2);
  }

  const rendered =
    parsed.format === 'json'
      ? JSON.stringify(snapshot, null, 2)
      : renderSelfReviewMarkdown(snapshot);

  if (parsed.outputPath !== null) {
    try {
      writeFileSync(parsed.outputPath, rendered, 'utf-8');
    } catch (e) {
      stderr(`mentor-self-review: failed to write report: ${describeError(e)}`);
      return exit(2);
    }
    stdout(`wrote ${parsed.outputPath}`);
    return exit(0);
  }

  stdout(rendered);
  return exit(0);
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  if (argv.length === 0) {
    throw new Error('missing subcommand (run|help)');
  }
  const sub = argv[0];
  if (sub !== 'run' && sub !== 'help') {
    throw new Error(`unknown subcommand ${JSON.stringify(sub)}; expected run|help`);
  }

  let memoryDir = env['CAIA_MEMORY_DIR'];
  let windowDays = DEFAULT_WINDOW_DAYS;
  let topN = DEFAULT_TOP_CLUSTERS;
  let outputPath: string | null = null;
  let format: 'md' | 'json' = 'md';

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--memory') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--memory requires a value');
      memoryDir = v;
    } else if (arg === '--window-days') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--window-days requires a value');
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
        throw new Error(
          `--window-days must be a positive integer; got ${JSON.stringify(v)}`
        );
      }
      windowDays = n;
    } else if (arg === '--top-n') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--top-n requires a value');
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
        throw new Error(`--top-n must be a positive integer; got ${JSON.stringify(v)}`);
      }
      topN = n;
    } else if (arg === '--output') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--output requires a value');
      outputPath = v;
    } else if (arg === '--format') {
      i++;
      const v = argv[i];
      if (v !== 'md' && v !== 'json') {
        throw new Error(`--format must be md|json; got ${JSON.stringify(v)}`);
      }
      format = v;
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
    windowDays,
    topN,
    outputPath,
    format
  };
}

function usage(): string {
  return `caia-mentor-self-review — Mentor Phase-4 quarterly self-review

Usage:
  caia-mentor-self-review run [--memory <dir>] [--window-days N] [--top-n N] [--output <path>] [--format md|json]
  caia-mentor-self-review help

Defaults:
  --window-days  ${DEFAULT_WINDOW_DAYS}
  --top-n        ${DEFAULT_TOP_CLUSTERS}
  --format       md

Environment:
  CAIA_MEMORY_DIR   Memory directory (must contain _mentor-index.sqlite)
`;
}

function numberOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
    process.stderr.write(`mentor-self-review: fatal: ${describeError(e)}\n`);
    process.exit(2);
  });
}
