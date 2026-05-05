#!/usr/bin/env node
/**
 * caia-mentor-cluster — Mentor Phase-4 PR-1 CLI.
 *
 * Reads the persistent retrieval index built by `caia-mentor-index
 * build` and emits clusters of proposals grouped by (classification,
 * topic). Used by:
 *
 *   - operator inspection (does anything systemic stand out today?)
 *   - PR-2 (Steward-rule proposal generator) — consumes the JSON output
 *   - PR-3 (quarterly self-review) — feeds aggregate metrics
 *
 * Subcommands:
 *
 *   list    — Print clusters as JSON. Default: only systemic clusters
 *             (occurrence >= --threshold). Pass `--all` to include
 *             one-offs.
 *
 *   help    — Print usage and exit 0.
 *
 * Flags:
 *
 *   --memory     <path>    Override the memory dir. Default:
 *                          $CAIA_MEMORY_DIR.
 *   --threshold  <N>       Systemic threshold. Default: 3.
 *   --burst-ms   <N>       Burst-window in ms. Default: 3600000 (1 h).
 *   --all                  Include one-off clusters too.
 *   --format     <text|json>  Output format. Default: json.
 *
 * Exit codes:
 *
 *   0   — success
 *   1   — usage error
 *   2   — runtime failure (no index DB; couldn't open store)
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  clusterProposals,
  DEFAULT_BURST_WINDOW_MS,
  DEFAULT_SYSTEMIC_THRESHOLD,
  systemicClusters,
  type Cluster
} from './cluster.js';
import { openIndexStore } from './index-store.js';

interface ParsedArgs {
  subcommand: 'list' | 'help';
  memoryDir: string;
  threshold: number;
  burstWindowMs: number;
  all: boolean;
  format: 'text' | 'json';
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
    stderr(`mentor-cluster: ${describeError(e)}`);
    stderr('run `caia-mentor-cluster help` for usage');
    return exit(1);
  }

  if (parsed.subcommand === 'help') {
    stdout(usage());
    return exit(0);
  }

  // list
  const dbPath = join(parsed.memoryDir, '_mentor-index.sqlite');
  if (!existsSync(dbPath)) {
    stderr(
      `mentor-cluster: no index DB at ${dbPath}; run \`caia-mentor-index build\` first`
    );
    return exit(2);
  }

  let clusters: Cluster[];
  try {
    const store = openIndexStore({
      memoryDir: parsed.memoryDir,
      readonly: true
    });
    try {
      const all = store.listAll();
      clusters = clusterProposals(all, {
        systemicThreshold: parsed.threshold,
        burstWindowMs: parsed.burstWindowMs
      });
    } finally {
      store.close();
    }
  } catch (e) {
    stderr(`mentor-cluster: failed to read index: ${describeError(e)}`);
    return exit(2);
  }

  const output = parsed.all ? clusters : systemicClusters(clusters);

  if (parsed.format === 'text') {
    stdout(renderText(output, parsed.threshold));
  } else {
    stdout(
      JSON.stringify(
        {
          memoryDir: parsed.memoryDir,
          threshold: parsed.threshold,
          burstWindowMs: parsed.burstWindowMs,
          totalClusters: clusters.length,
          systemicCount: clusters.filter((c) => c.systemic).length,
          clusters: output.map(serialiseCluster)
        },
        null,
        2
      )
    );
  }
  return exit(0);
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  if (argv.length === 0) {
    throw new Error('missing subcommand (list|help)');
  }
  const sub = argv[0];
  if (sub !== 'list' && sub !== 'help') {
    throw new Error(`unknown subcommand ${JSON.stringify(sub)}; expected list|help`);
  }

  let memoryDir = env['CAIA_MEMORY_DIR'];
  let threshold = DEFAULT_SYSTEMIC_THRESHOLD;
  let burstWindowMs = DEFAULT_BURST_WINDOW_MS;
  let all = false;
  let format: 'text' | 'json' = 'json';

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--memory') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--memory requires a value');
      memoryDir = v;
    } else if (arg === '--threshold') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--threshold requires a value');
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || !Number.isInteger(n)) {
        throw new Error(`--threshold must be a positive integer; got ${JSON.stringify(v)}`);
      }
      threshold = n;
    } else if (arg === '--burst-ms') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--burst-ms requires a value');
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`--burst-ms must be a non-negative number; got ${JSON.stringify(v)}`);
      }
      burstWindowMs = n;
    } else if (arg === '--all') {
      all = true;
    } else if (arg === '--format') {
      i++;
      const v = argv[i];
      if (v !== 'text' && v !== 'json') {
        throw new Error(`--format must be text|json; got ${JSON.stringify(v)}`);
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
    threshold,
    burstWindowMs,
    all,
    format
  };
}

function serialiseCluster(c: Cluster): {
  classification: string;
  topicSlug: string;
  occurrenceCount: number;
  systemic: boolean;
  burst: boolean;
  firstSeenIso: string;
  lastSeenIso: string;
  spanMs: number;
  members: { sourcePath: string; rawSlug: string; timestampIso: string }[];
} {
  return {
    classification: c.classification,
    topicSlug: c.topicSlug,
    occurrenceCount: c.occurrenceCount,
    systemic: c.systemic,
    burst: c.burst,
    firstSeenIso: new Date(c.firstSeenMs).toISOString(),
    lastSeenIso: new Date(c.lastSeenMs).toISOString(),
    spanMs: c.lastSeenMs - c.firstSeenMs,
    members: c.members.map((m) => ({
      sourcePath: m.sourcePath,
      rawSlug: m.rawSlug,
      timestampIso: new Date(m.timestampMs).toISOString()
    }))
  };
}

function renderText(clusters: Cluster[], threshold: number): string {
  if (clusters.length === 0) {
    return `(no clusters with occurrence >= ${threshold})`;
  }
  const lines: string[] = [];
  for (const c of clusters) {
    const tag = c.systemic ? 'SYSTEMIC' : 'one-off ';
    const burstTag = c.burst ? ' [burst]' : '';
    const span = formatSpan(c.lastSeenMs - c.firstSeenMs);
    lines.push(
      `${tag} x${String(c.occurrenceCount).padStart(3)}  ${c.classification}/${c.topicSlug}  (span ${span})${burstTag}`
    );
  }
  return lines.join('\n');
}

function formatSpan(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h${min % 60}m`;
  const d = Math.floor(hr / 24);
  return `${d}d${hr % 24}h`;
}

function usage(): string {
  return `caia-mentor-cluster — Mentor Phase-4 incident clustering

Usage:
  caia-mentor-cluster list [--memory <dir>] [--threshold N] [--burst-ms N] [--all] [--format text|json]
  caia-mentor-cluster help

Defaults:
  --threshold  ${DEFAULT_SYSTEMIC_THRESHOLD}
  --burst-ms   ${DEFAULT_BURST_WINDOW_MS}
  --format     json

Environment:
  CAIA_MEMORY_DIR   Memory directory (must contain _mentor-index.sqlite)
`;
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
    process.stderr.write(`mentor-cluster: fatal: ${describeError(e)}\n`);
    process.exit(2);
  });
}
