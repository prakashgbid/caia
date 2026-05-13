// CLI wrapper for `caia-pr-create-safe`.
//
// Usage:
//   caia-pr-create-safe [--base develop] [--remote origin] [--workdir DIR] \
//                       -- <gh pr create args...>
//
// Everything after `--` is passed verbatim to `gh pr create`.

import { createSafe } from './index.js';

interface ParsedArgs {
  base?: string;
  remote?: string;
  workdir?: string;
  json?: boolean;
  ghArgs: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { ghArgs: [] };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i] ?? '';
    if (a === '--') {
      out.ghArgs = argv.slice(i + 1);
      break;
    }
    const consume = (): string => {
      const v = argv[i + 1];
      i += 1;
      if (v === undefined) {
        throw new Error(`flag ${a} requires a value`);
      }
      return v;
    };
    switch (a) {
      case '--base':
        out.base = consume();
        break;
      case '--remote':
        out.remote = consume();
        break;
      case '--workdir':
        out.workdir = consume();
        break;
      case '--json':
        out.json = true;
        break;
      case '-h':
      case '--help':
        printHelp();
        process.exit(0);
        break;
      default:
        if (a.startsWith('--')) {
          throw new Error(`unknown flag: ${a}`);
        }
    }
    i += 1;
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(`caia-pr-create-safe — rebase-on-base before gh pr create

Options (before --):
  --base BRANCH        default: develop
  --remote REMOTE      default: origin
  --workdir DIR        git checkout to operate in (default: cwd)
  --json               machine-readable result

Everything after \`--\` is passed verbatim to \`gh pr create\`.
`);
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    printHelp();
    process.exit(2);
  }

  const result = await createSafe({
    base: args.base,
    remote: args.remote,
    cwd: args.workdir,
    ghCreateArgs: args.ghArgs,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.kind === 'created') {
    process.stdout.write(`${result.output}\n`);
  } else {
    process.stderr.write(`${result.kind}: ${result.reason}\n`);
  }
  process.exit(result.kind === 'created' ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
