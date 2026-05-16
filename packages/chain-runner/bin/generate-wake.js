#!/usr/bin/env node
// B4 (2026-05-15). Thin CLI that renders a per-chain wake script from the
// canonical template at bin/templates/wake.sh.template and writes it to
// $HOME/.caia/wake-scripts/<chain-id>.sh. Parallels generate-run-phase.js.
//
// Usage:
//   generate-wake.js \
//     --chain-id <id> \
//     --phases <yaml-path> \
//     [--runner <path>] \
//     [--out <path>] \
//     [--write-legacy-wrapper] \
//     [--legacy-wrapper-path <path>] \
//     [--log-slug <slug>] \
//     [--force]
//
// Exits 0 on success, 2 on argument error, 3 on file-already-exists.

import { generateWake } from '../dist/wake-generator.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const peek = () => argv[++i];
    switch (a) {
      case '--chain-id': out.chainId = peek(); break;
      case '--phases': out.phasesYaml = peek(); break;
      case '--runner': out.runnerScript = peek(); break;
      case '--out': out.out = peek(); break;
      case '--template': out.templatePath = peek(); break;
      case '--caia-chain-bin': out.caiaChainBin = peek(); break;
      case '--log-slug': out.logSlug = peek(); break;
      case '--write-legacy-wrapper': out.writeLegacyWrapper = true; break;
      case '--legacy-wrapper-path': out.legacyWrapperPath = peek(); break;
      case '--force': out.force = true; break;
      case '-h':
      case '--help':
        out._help = true; break;
      default:
        process.stderr.write(`unknown flag: ${a}\n`);
        process.exit(2);
    }
  }
  return out;
}

const HELP = `generate-wake.js — render a chain wake script from the canonical template

Required:
  --chain-id <id>            e.g. "redflag-remediation"
  --phases <yaml-path>       absolute path to the chain's phases YAML

Optional:
  --runner <path>            dispatcher path the wake will spawn (default: legacy agent-memory _<slug>_run_phase.sh)
  --out <path>               override output path (default ~/.caia/wake-scripts/<chain-id>.sh)
  --template <path>          override canonical template path (for tests)
  --caia-chain-bin <path>    override the bin/caia-chain.js path
  --log-slug <slug>          override the slug used in WATCHDOG_LOG (preserves legacy log layouts)
  --write-legacy-wrapper     also write ~/.caia/chain-watchdog/<slug>_wake.sh as a wrapper
  --legacy-wrapper-path <p>  override the legacy wrapper destination
  --force                    overwrite existing files

Exit codes: 0=ok, 2=bad args, 3=file exists (use --force to overwrite)
`;

const opts = parseArgs(process.argv.slice(2));
if (opts._help) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (!opts.chainId || !opts.phasesYaml) {
  process.stderr.write('error: --chain-id and --phases are required\n\n');
  process.stderr.write(HELP);
  process.exit(2);
}

try {
  const r = generateWake(opts);
  process.stdout.write(
    `generated wake=${r.wakeScriptPath} fingerprint=${r.fingerprint}` +
      (r.legacyWrapperPath ? ` wrapper=${r.legacyWrapperPath}` : '') +
      '\n',
  );
  process.exit(0);
} catch (err) {
  const msg = (err && err.message) || String(err);
  process.stderr.write(`error: ${msg}\n`);
  if (msg.includes('already exists')) process.exit(3);
  process.exit(1);
}
