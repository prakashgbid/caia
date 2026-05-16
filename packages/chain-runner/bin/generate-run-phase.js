#!/usr/bin/env node
// B3 (2026-05-15). Thin CLI that generates a per-chain run-phase dispatcher
// from the canonical template at bin/templates/run-phase.sh.template and
// writes it to $HOME/.caia/dispatchers/<chain-id>.sh.
//
// Usage:
//   generate-run-phase.js \
//     --chain-id <id> \
//     --phases <yaml-path> \
//     [--log-dir <dir>] \
//     [--out <path>] \
//     [--write-legacy-wrapper] \
//     [--force]
//
// Exits 0 on success, 2 on argument error, 3 on file-already-exists.

import { generateDispatcher } from '../dist/dispatcher-generator.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const peek = () => argv[++i];
    switch (a) {
      case '--chain-id': out.chainId = peek(); break;
      case '--phases': out.phasesYaml = peek(); break;
      case '--log-dir': out.logDir = peek(); break;
      case '--out': out.out = peek(); break;
      case '--template': out.templatePath = peek(); break;
      case '--caia-chain-bin': out.caiaChainBin = peek(); break;
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

const HELP = `generate-run-phase.js — render a chain dispatcher from the canonical template

Required:
  --chain-id <id>            e.g. "redflag-remediation"
  --phases <yaml-path>       absolute path to the chain's phases YAML

Optional:
  --log-dir <dir>            override the phase-log dir baked into the dispatcher
  --out <path>               override output path (default ~/.caia/dispatchers/<chain-id>.sh)
  --template <path>          override canonical template path (for tests)
  --caia-chain-bin <path>    override the bin/caia-chain.js path
  --write-legacy-wrapper     also write agent-memory/_<slug>_run_phase.sh as a 3-line
                             exec stub (preserves wake.sh's baked-in runner path)
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
  const r = generateDispatcher(opts);
  process.stdout.write(
    `generated dispatcher=${r.dispatcherPath} fingerprint=${r.fingerprint}` +
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
