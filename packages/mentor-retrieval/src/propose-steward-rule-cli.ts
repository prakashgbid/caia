#!/usr/bin/env node
/**
 * caia-mentor-propose-steward-rule — Mentor Phase-4 PR-2 CLI.
 *
 * Reads the persisted lesson index, runs the Phase-4 PR-1 clusterer,
 * and emits a Steward-rule proposal (one per systemic cluster).
 *
 * Subcommands:
 *
 *   list   — Print the proposals as JSON or markdown without writing
 *            anything. Default output: JSON.
 *
 *   write  — Write each proposal to
 *            `<memoryDir>/proposals/<proposalSlug>.md`. Existing files
 *            are preserved unless `--force` is passed (so an operator
 *            mid-review doesn't get their notes clobbered).
 *
 *   help   — Print usage and exit 0.
 *
 * Flags:
 *
 *   --memory      <path>      Override the memory dir (default $CAIA_MEMORY_DIR).
 *   --threshold   <N>         Systemic threshold (default 3).
 *   --burst-ms    <N>         Burst window ms (default 3600000).
 *   --include-bursts          Include burst clusters too. Default: skip
 *                             bursts because they usually mean a single
 *                             watcher loop emitted N duplicates rather
 *                             than N independent failures.
 *   --force                   `write` overwrites existing proposals.
 *   --format      <text|json> `list` output format. Default: json.
 *
 * Exit codes:
 *
 *   0   — success (zero or more proposals)
 *   1   — usage error
 *   2   — runtime failure (no index DB, couldn't write, etc.)
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
import {
  proposeStewardRule,
  renderStewardRuleProposalMarkdown,
  writeStewardRuleProposals,
  type StewardRuleProposal,
  type WriteStewardRuleProposalsResult
} from './steward-rule-proposer.js';

interface ParsedArgs {
  subcommand: 'list' | 'write' | 'help';
  memoryDir: string;
  threshold: number;
  burstWindowMs: number;
  includeBursts: boolean;
  force: boolean;
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
    stderr(`mentor-propose-steward-rule: ${describeError(e)}`);
    stderr('run `caia-mentor-propose-steward-rule help` for usage');
    return exit(1);
  }

  if (parsed.subcommand === 'help') {
    stdout(usage());
    return exit(0);
  }

  // Common: load + cluster.
  const dbPath = join(parsed.memoryDir, '_mentor-index.sqlite');
  if (!existsSync(dbPath)) {
    stderr(
      `mentor-propose-steward-rule: no index DB at ${dbPath}; run \`caia-mentor-index build\` first`
    );
    return exit(2);
  }

  let candidateClusters: Cluster[];
  try {
    const store = openIndexStore({ memoryDir: parsed.memoryDir, readonly: true });
    try {
      const all = store.listAll();
      const clusters = clusterProposals(all, {
        systemicThreshold: parsed.threshold,
        burstWindowMs: parsed.burstWindowMs
      });
      const sys = systemicClusters(clusters);
      candidateClusters = parsed.includeBursts ? sys : sys.filter((c) => !c.burst);
    } finally {
      store.close();
    }
  } catch (e) {
    stderr(`mentor-propose-steward-rule: failed to read index: ${describeError(e)}`);
    return exit(2);
  }

  const proposals = candidateClusters.map((c) => proposeStewardRule(c));

  if (parsed.subcommand === 'list') {
    if (parsed.format === 'text') {
      stdout(renderListText(proposals));
    } else {
      stdout(JSON.stringify({ count: proposals.length, proposals }, null, 2));
    }
    return exit(0);
  }

  // write
  let writeResult: WriteStewardRuleProposalsResult;
  try {
    writeResult = writeStewardRuleProposals(candidateClusters, {
      memoryDir: parsed.memoryDir,
      force: parsed.force
    });
  } catch (e) {
    stderr(`mentor-propose-steward-rule write failed: ${describeError(e)}`);
    return exit(2);
  }

  stdout(
    JSON.stringify(
      {
        proposalsDir: writeResult.proposalsDir,
        writtenCount: writeResult.written.length,
        skippedCount: writeResult.skipped.length,
        written: writeResult.written,
        skipped: writeResult.skipped
      },
      null,
      2
    )
  );
  return exit(0);
}

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): ParsedArgs {
  if (argv.length === 0) {
    throw new Error('missing subcommand (list|write|help)');
  }
  const sub = argv[0];
  if (sub !== 'list' && sub !== 'write' && sub !== 'help') {
    throw new Error(
      `unknown subcommand ${JSON.stringify(sub)}; expected list|write|help`
    );
  }

  let memoryDir = env['CAIA_MEMORY_DIR'];
  let threshold = DEFAULT_SYSTEMIC_THRESHOLD;
  let burstWindowMs = DEFAULT_BURST_WINDOW_MS;
  let includeBursts = false;
  let force = false;
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
        throw new Error(
          `--threshold must be a positive integer; got ${JSON.stringify(v)}`
        );
      }
      threshold = n;
    } else if (arg === '--burst-ms') {
      i++;
      const v = argv[i];
      if (v === undefined) throw new Error('--burst-ms requires a value');
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(
          `--burst-ms must be a non-negative number; got ${JSON.stringify(v)}`
        );
      }
      burstWindowMs = n;
    } else if (arg === '--include-bursts') {
      includeBursts = true;
    } else if (arg === '--force') {
      force = true;
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
    includeBursts,
    force,
    format
  };
}

function renderListText(proposals: StewardRuleProposal[]): string {
  if (proposals.length === 0) {
    return '(no systemic-cluster proposals)';
  }
  return proposals
    .map((p) => renderStewardRuleProposalMarkdown(p))
    .join('\n\n---\n\n');
}

function usage(): string {
  return `caia-mentor-propose-steward-rule — Mentor Phase-4 Steward-rule proposer

Usage:
  caia-mentor-propose-steward-rule list  [--memory <dir>] [--threshold N] [--burst-ms N] [--include-bursts] [--format text|json]
  caia-mentor-propose-steward-rule write [--memory <dir>] [--threshold N] [--burst-ms N] [--include-bursts] [--force]
  caia-mentor-propose-steward-rule help

Defaults:
  --threshold       ${DEFAULT_SYSTEMIC_THRESHOLD}
  --burst-ms        ${DEFAULT_BURST_WINDOW_MS}
  --include-bursts  off (burst clusters are usually a single watcher-loop replay)
  --force           off (existing proposals are preserved)
  --format          json

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
    process.stderr.write(`mentor-propose-steward-rule: fatal: ${describeError(e)}\n`);
    process.exit(2);
  });
}
