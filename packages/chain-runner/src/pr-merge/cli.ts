// CLI wrapper for `caia-pr-merge-or-fail`.
// Exits 0 ONLY when `gh pr view` returns state=MERGED && mergedAt != null.

import { mergeOrFail } from './index.js';

interface Args {
  repo?: string;
  pr?: number;
  timeoutSeconds?: number;
  pollIntervalSeconds?: number;
  workdir?: string;
  squashCommitTitle?: string;
  squashCommitBody?: string;
  dryRun?: boolean;
  json?: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? '';
    const consume = (): string => {
      const v = argv[i + 1];
      i += 1;
      if (v === undefined) {
        throw new Error(`flag ${a} requires a value`);
      }
      return v;
    };
    switch (a) {
      case '--repo':
        out.repo = consume();
        break;
      case '--pr':
        out.pr = Number(consume());
        break;
      case '--timeout-seconds':
        out.timeoutSeconds = Number(consume());
        break;
      case '--poll-interval-seconds':
        out.pollIntervalSeconds = Number(consume());
        break;
      case '--workdir':
        out.workdir = consume();
        break;
      case '--squash-title':
        out.squashCommitTitle = consume();
        break;
      case '--squash-body':
        out.squashCommitBody = consume();
        break;
      case '--dry-run':
        out.dryRun = true;
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
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(`caia-pr-merge-or-fail

Mandatory:
  --repo OWNER/REPO
  --pr   N

Optional:
  --timeout-seconds N         (default 900)
  --poll-interval-seconds N   (default 30)
  --workdir DIR               local git checkout for post-merge sweep
  --squash-title TITLE
  --squash-body BODY
  --dry-run                   inspect, don't merge
  --json                      machine-readable result

Exit codes:
  0  PR confirmed merged (state=MERGED && mergedAt!=null)
  1  any other outcome (with reason printed)
`);
}

async function main(): Promise<void> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    printHelp();
    process.exit(2);
  }

  if (!args.repo || !args.pr || Number.isNaN(args.pr)) {
    process.stderr.write('error: --repo and --pr are required\n');
    printHelp();
    process.exit(2);
  }

  const outcome = await mergeOrFail({
    repo: args.repo,
    pr: args.pr,
    timeoutSeconds: args.timeoutSeconds,
    pollIntervalSeconds: args.pollIntervalSeconds,
    workdir: args.workdir,
    squashCommitTitle: args.squashCommitTitle,
    squashCommitBody: args.squashCommitBody,
    dryRun: args.dryRun,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } else if (outcome.kind === 'merged') {
    process.stdout.write(
      `merged: ${args.repo}#${outcome.pr} at ${outcome.mergedAt}` +
        (outcome.bypassed ? ' (admin-bypass)' : '') +
        '\n',
    );
  } else {
    process.stderr.write(
      `not merged: ${args.repo}#${outcome.pr}: ${outcome.reason}\n`,
    );
  }
  process.exit(outcome.kind === 'merged' ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
