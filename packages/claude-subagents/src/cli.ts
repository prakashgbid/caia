#!/usr/bin/env node
/**
 * CLI entrypoint for @chiefaia/claude-subagents.
 *
 * Subcommands:
 *
 *   install [--target <dir>] [--force] [--only <name1,name2,...>]
 *     Copy the shipped subagent .md files to the target directory
 *     (defaults to `~/.claude/agents/`). Idempotent — files whose
 *     on-disk SHA matches the shipped SHA are skipped unless --force.
 *
 *   verify [--target <dir>] [--only <name1,name2,...>]
 *     Compare on-disk files to shipped definitions. Exits 0 when every
 *     expected file is present + matches, non-zero when any drift /
 *     missing files are detected.
 *
 *   list
 *     Print the manifest entries one per line as JSON.
 *
 *   show <name>
 *     Print the .md content for a single subagent.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MANIFEST, findEntryByName } from './manifest.js';
import { installSubagents, verifyInstalled } from './installer.js';
import { defaultTargetDir, shippedAgentsDir } from './paths.js';

interface Argv {
  positional: string[];
  flags: Record<string, string>;
}

function parseArgs(argv: string[]): Argv {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = '1';
      }
    } else {
      positional.push(token);
    }
  }
  return { positional, flags };
}

function only(args: Argv): string[] | undefined {
  const raw = args.flags['only'];
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function targetDirOrDefault(args: Argv): string {
  return args.flags['target'] ?? defaultTargetDir();
}

function install(args: Argv): void {
  const onlyList = only(args);
  const result = installSubagents({
    targetDir: targetDirOrDefault(args),
    force: args.flags['force'] === '1',
    ...(onlyList !== undefined ? { only: onlyList } : {})
  });
  console.log(
    JSON.stringify({
      ok: true,
      targetDir: result.targetDir,
      writtenCount: result.writtenCount,
      skippedCount: result.skippedCount,
      overwrittenCount: result.overwrittenCount,
      results: result.results
    })
  );
}

function verify(args: Argv): void {
  const onlyList = only(args);
  const result = verifyInstalled({
    targetDir: targetDirOrDefault(args),
    ...(onlyList !== undefined ? { only: onlyList } : {})
  });
  console.log(
    JSON.stringify({
      ok: result.ok,
      targetDir: result.targetDir,
      presentCount: result.presentCount,
      driftedCount: result.driftedCount,
      missingCount: result.missingCount,
      results: result.results
    })
  );
  if (!result.ok) {
    process.exit(2);
  }
}

function list(): void {
  for (const e of MANIFEST.entries) {
    console.log(
      JSON.stringify({
        name: e.name,
        tier: e.tier,
        model: e.model,
        tools: e.tools,
        description: e.description
      })
    );
  }
}

function show(args: Argv): void {
  const name = args.positional[0];
  if (!name) {
    console.error('usage: caia-claude-subagents show <name>');
    process.exit(2);
  }
  const entry = findEntryByName(name);
  if (!entry) {
    console.error(
      `unknown subagent: ${name}. Available: ${MANIFEST.entries.map((e) => e.name).join(', ')}`
    );
    process.exit(2);
  }
  const path = join(shippedAgentsDir(), entry.filename);
  process.stdout.write(readFileSync(path, 'utf-8'));
}

function usage(): never {
  console.error(
    [
      'Usage: caia-claude-subagents <subcommand> [flags]',
      '',
      'Subcommands:',
      '  install [--target <dir>] [--force] [--only <name1,name2,...>]',
      '  verify  [--target <dir>] [--only <name1,name2,...>]',
      '  list',
      '  show <name>',
      '',
      'Defaults:',
      '  --target  ~/.claude/agents/',
      '',
      'Examples:',
      '  caia-claude-subagents install',
      '  caia-claude-subagents install --only caia-ba,caia-ea --force',
      '  caia-claude-subagents verify',
      '  caia-claude-subagents list',
      '  caia-claude-subagents show caia-coding'
    ].join('\n')
  );
  process.exit(2);
}

export function main(argv: string[]): void {
  const [sub, ...rest] = argv;
  const args = parseArgs(rest);
  switch (sub) {
    case 'install':
      install(args);
      return;
    case 'verify':
      verify(args);
      return;
    case 'list':
      list();
      return;
    case 'show':
      show(args);
      return;
    case undefined:
    case '--help':
    case '-h':
      usage();
      return;
    default:
      console.error(`unknown subcommand: ${sub}`);
      usage();
  }
}

const isMain =
  process.argv[1] !== undefined &&
  (import.meta.url === `file://${process.argv[1]}` ||
    import.meta.url.endsWith(process.argv[1]) ||
    fileURLToPath(import.meta.url) === process.argv[1]);

if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (e: unknown) {
    console.error(`[caia-claude-subagents] fatal: ${String(e)}`);
    process.exit(1);
  }
}
