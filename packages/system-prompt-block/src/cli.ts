#!/usr/bin/env node
/**
 * caia-system-prompt-block — CLI for generating the CAIA primer.
 *
 * Resolves CAIA defaults to absolute paths under the operator's HOME +
 * the (currently-running) Claude session id, calls generateCaiaPrimer,
 * and prints the primer to stdout (or writes it to --out).
 *
 * Flags:
 *   --memory-index <path>      override default memory index path
 *   --architecture-doc <path>  override default architecture doc path
 *   --dod-source <path>        override default DoD-source path
 *   --token-budget <n>         override default 1000 token budget
 *   --summarise-on-overflow    trim deterministically if over budget
 *                              (default: throw on overflow)
 *   --out <path>               write to file instead of stdout
 *   --debug                    print PrimerResult JSON instead of just
 *                              the text
 *   --help                     show this help and exit
 */

import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';

import {
  DEFAULT_ARCHITECTURE_DOC_PATH,
  DEFAULT_DOD_SOURCE_PATH,
  DEFAULT_MEMORY_INDEX_PATH,
  DEFAULT_TOKEN_BUDGET
} from './defaults.js';
import { generateCaiaPrimer } from './generate.js';

interface CliFlags {
  memoryIndex?: string;
  architectureDoc?: string;
  dodSource?: string;
  tokenBudget?: number;
  summariseOnOverflow: boolean;
  out?: string;
  debug: boolean;
  help: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    summariseOnOverflow: false,
    debug: false,
    help: false
  };
  const requireValue = (flag: string, idx: number): string => {
    const v = argv[idx];
    if (v === undefined) throw new Error(`${flag} requires a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--memory-index':
        flags.memoryIndex = requireValue('--memory-index', ++i);
        break;
      case '--architecture-doc':
        flags.architectureDoc = requireValue('--architecture-doc', ++i);
        break;
      case '--dod-source':
        flags.dodSource = requireValue('--dod-source', ++i);
        break;
      case '--token-budget': {
        const v = requireValue('--token-budget', ++i);
        flags.tokenBudget = Number(v);
        if (!Number.isFinite(flags.tokenBudget) || flags.tokenBudget <= 0) {
          throw new Error(`--token-budget invalid: ${v}`);
        }
        break;
      }
      case '--summarise-on-overflow':
      case '--summarize-on-overflow':
        flags.summariseOnOverflow = true;
        break;
      case '--out':
        flags.out = requireValue('--out', ++i);
        break;
      case '--debug':
        flags.debug = true;
        break;
      case '--help':
      case '-h':
        flags.help = true;
        break;
      default:
        throw new Error(`unknown flag: ${arg}`);
    }
  }
  return flags;
}

/**
 * Resolve a "~/..." or "<session-id>"-bearing default path to an
 * absolute filesystem path. Operator's HOME comes from os.homedir().
 *
 * Note: this resolution lives in the CLI, NOT in the generator core —
 * the generator core stays parameter-driven so tests can pass in
 * fixture paths without going through homedir() at all (Option E gate
 * 2: parameterised public API).
 */
function resolveDefaultPath(defaultPath: string): string {
  let resolved = defaultPath;
  if (resolved.startsWith('~/')) {
    resolved = `${homedir()}/${resolved.slice(2)}`;
  }
  return resolved;
}

function showHelp(): void {
  const lines = [
    'caia-system-prompt-block — generate the CAIA primer block',
    '',
    'Usage: caia-system-prompt-block [options]',
    '',
    'Options:',
    '  --memory-index <path>      override default memory-index path',
    '  --architecture-doc <path>  override default architecture-doc path',
    '  --dod-source <path>        override default DoD-source path',
    '  --token-budget <n>         override default 1000 token budget',
    '  --summarise-on-overflow    trim deterministically if over budget',
    '  --out <path>               write to file instead of stdout',
    '  --debug                    print PrimerResult JSON instead of text',
    '  --help                     show this help',
    '',
    'Defaults are resolved from $HOME for "~/..." prefixes. The "<session-id>"',
    'placeholder in default paths must be replaced via --memory-index etc. when',
    'invoked outside an active Claude session — the package itself never',
    'knows the session id.'
  ];
  console.log(lines.join('\n'));
}

function main(argv: string[]): number {
  let flags: CliFlags;
  try {
    flags = parseFlags(argv);
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }
  if (flags.help) {
    showHelp();
    return 0;
  }

  const memoryIndexPath = flags.memoryIndex
    ?? resolveDefaultPath(DEFAULT_MEMORY_INDEX_PATH);
  const architectureDocPath = flags.architectureDoc
    ?? resolveDefaultPath(DEFAULT_ARCHITECTURE_DOC_PATH);
  const dodSourcePath = flags.dodSource
    ?? resolveDefaultPath(DEFAULT_DOD_SOURCE_PATH);
  const tokenBudget = flags.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  let result;
  try {
    result = generateCaiaPrimer({
      memoryIndexPath,
      architectureDocPath,
      dodSourcePath,
      tokenBudget,
      summariseOnOverflow: flags.summariseOnOverflow
    });
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }

  const out = flags.debug
    ? JSON.stringify(result, null, 2) + '\n'
    : result.text;

  if (flags.out !== undefined) {
    writeFileSync(flags.out, out, 'utf-8');
    console.error(
      `wrote ${out.length} bytes (${result.estimatedTokens} est. tokens` +
        `${result.trimmed ? ', trimmed' : ''}) → ${flags.out}`
    );
  } else {
    process.stdout.write(out);
  }

  return 0;
}

const exitCode = main(process.argv.slice(2));
process.exit(exitCode);
