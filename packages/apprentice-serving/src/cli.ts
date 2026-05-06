#!/usr/bin/env node
/**
 * caia-apprentice-serving — CLI for ApprenticeServing.
 *
 * Usage:
 *   caia-apprentice-serving register <adapter-path>
 *   caia-apprentice-serving promote-canary <adapter-path> --percent <0..100>
 *   caia-apprentice-serving promote-production <adapter-path>
 *   caia-apprentice-serving rollback <adapter-path>
 *   caia-apprentice-serving reject <adapter-path> --reason "<reason>"
 *   caia-apprentice-serving list [--status <status>]
 *   caia-apprentice-serving show <adapter-path>
 *   caia-apprentice-serving canary-config
 *
 * Common flags:
 *   --registry-path <path>
 *   --canary-routing-path <path>
 *   --ollama-binary <path>
 */

import { ApprenticeServing } from './serving.js';
import { ServingError } from './types.js';
import type { ApprenticeServingConfig } from './types.js';
import type { RegistryStatus } from './types.js';

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string>;
  booleanFlags: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  const booleanFlags = new Set<string>();
  let command = '';
  let i = 0;
  if (argv[0] && !argv[0].startsWith('--')) {
    command = argv[0]!;
    i = 1;
  }
  while (i < argv.length) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        booleanFlags.add(key);
        i += 1;
      }
    } else {
      positional.push(arg);
      i += 1;
    }
  }
  return { command, positional, flags, booleanFlags };
}

function buildConfig(flags: Record<string, string>): ApprenticeServingConfig {
  const cfg: ApprenticeServingConfig = {};
  if (flags['registry-path']) cfg.registryPath = flags['registry-path'];
  if (flags['canary-routing-path']) cfg.canaryRoutingConfigPath = flags['canary-routing-path'];
  if (flags['ollama-binary']) cfg.ollamaBinaryPath = flags['ollama-binary'];
  return cfg;
}

function printHelp(): void {
  process.stdout.write(
    [
      'caia-apprentice-serving — Apprentice Phase 3 adapter serving CLI',
      '',
      'Commands:',
      '  register <adapter-path>',
      '  promote-canary <adapter-path> --percent <0..100>',
      '  promote-production <adapter-path>',
      '  rollback <adapter-path>',
      '  reject <adapter-path> --reason "<reason>"',
      '  list [--status <status>]',
      '  show <adapter-path>',
      '  canary-config',
      '',
      'Common flags:',
      '  --registry-path <path>',
      '  --canary-routing-path <path>',
      '  --ollama-binary <path>',
      ''
    ].join('\n')
  );
}

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.command || parsed.command === 'help' || parsed.booleanFlags.has('help')) {
    printHelp();
    return 0;
  }
  const cfg = buildConfig(parsed.flags);
  const serving = new ApprenticeServing(cfg);

  try {
    switch (parsed.command) {
      case 'register': {
        const p = requirePositional(parsed.positional, 0, 'adapter-path');
        const entry = await serving.register(p);
        process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
        return 0;
      }
      case 'promote-canary': {
        const p = requirePositional(parsed.positional, 0, 'adapter-path');
        const pct = requireNumberFlag(parsed.flags, 'percent');
        const entry = await serving.promoteToCanary(p, pct);
        process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
        return 0;
      }
      case 'promote-production': {
        const p = requirePositional(parsed.positional, 0, 'adapter-path');
        const entry = await serving.promoteToProduction(p);
        process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
        return 0;
      }
      case 'rollback': {
        const p = requirePositional(parsed.positional, 0, 'adapter-path');
        const entry = await serving.rollback(p);
        process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
        return 0;
      }
      case 'reject': {
        const p = requirePositional(parsed.positional, 0, 'adapter-path');
        const reason = parsed.flags['reason'] ?? '';
        const entry = await serving.reject(p, reason);
        process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
        return 0;
      }
      case 'list': {
        const status = parsed.flags['status'] as RegistryStatus | undefined;
        let entries = serving.list();
        if (status !== undefined) entries = entries.filter((e) => e.status === status);
        process.stdout.write(JSON.stringify(entries, null, 2) + '\n');
        return 0;
      }
      case 'show': {
        const p = requirePositional(parsed.positional, 0, 'adapter-path');
        const entry = serving.registry.getByName(basename(p));
        if (!entry) {
          process.stderr.write(`adapter not in registry: ${p}\n`);
          return 4;
        }
        process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
        return 0;
      }
      case 'canary-config': {
        const decision = serving.canaryRouter.resolve();
        process.stdout.write(JSON.stringify(decision, null, 2) + '\n');
        return 0;
      }
      default:
        process.stderr.write(`unknown command: ${parsed.command}\n`);
        printHelp();
        return 1;
    }
  } catch (e) {
    if (e instanceof ServingError) {
      process.stderr.write(`${e.name}: ${e.message}\n`);
      if (e.details) process.stderr.write(JSON.stringify(e.details, null, 2) + '\n');
      return classify(e.name);
    }
    process.stderr.write(`unexpected error: ${(e as Error).message ?? String(e)}\n`);
    return 1;
  }
}

function classify(name: string): number {
  if (
    name === 'OllamaCreateError' ||
    name === 'OllamaRemoveError' ||
    name === 'OllamaInspectError' ||
    name === 'OllamaNotInstalledError'
  ) {
    return 2;
  }
  if (name === 'AdapterNotFoundError' || name === 'MetadataMalformedError') return 4;
  return 1;
}

function requirePositional(positional: string[], index: number, name: string): string {
  const v = positional[index];
  if (v === undefined) {
    throw new Error(`missing positional argument: ${name}`);
  }
  return v;
}

function requireNumberFlag(flags: Record<string, string>, name: string): number {
  const v = flags[name];
  if (v === undefined) throw new Error(`missing flag: --${name}`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`flag --${name} is not a number: ${v}`);
  return n;
}

function basename(p: string): string {
  const parts = p.split('/');
  return parts[parts.length - 1] || p;
}

// Bin entry
const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('cli.js');
if (isMain) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
