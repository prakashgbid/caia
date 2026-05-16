#!/usr/bin/env node
// caia-adopt — adoption-enforcement substrate CLI.
//
// Sub-command dispatcher (verb after the binary name). v1 ships a single
// verb, `gate-check`, used by scripts/gate-mark-done.sh as the final
// chokepoint for DoD v2 Guardrail #10 (adoption-everywhere).
//
//   caia-adopt gate-check --chain <chain-id> [--ledger <path>]
//                         [--stuck-opened-days <n>] [--json]
//
// Exit codes (matched to scripts/gate-mark-done.sh contract):
//   0  gate passes (ok=true) — no blockers, safe to mark-done
//   1  gate blocks (ok=false) — one or more pending opportunities; abort
//   2  argument / usage error
//
// The verb is intentionally thin: it delegates to checkAdoptionGate() from
// @chiefaia/chain-runner so the gate's logic stays in one place (the
// programmatic gate is the source of truth; this CLI just renders it).

import { checkAdoptionGate } from '@chiefaia/chain-runner';

const USAGE = `Usage: caia-adopt <verb> [options]

Verbs:
  gate-check    Check the adoption-everywhere gate for a chain.

Run 'caia-adopt <verb> --help' for verb-specific options.
`;

const GATE_CHECK_USAGE = `Usage: caia-adopt gate-check --chain <chain-id> [options]

Options:
  --chain <id>              chain identifier (required)
  --ledger <path>           override ledger path (default: ~/.caia/adoption/ledger.jsonl)
  --stuck-opened-days <n>   override stuck-opened threshold (default: 14)
  --json                    print machine-readable JSON result
  -h, --help                print this help

Exit codes: 0 = gate passes, 1 = gate blocks, 2 = usage error.
`;

function die(msg, code = 2) {
  process.stderr.write(`caia-adopt: ${msg}\n`);
  process.exit(code);
}

function parseGateCheckArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--chain':
        if (!next) die('--chain requires a value');
        out.chain = next;
        i += 1;
        break;
      case '--ledger':
        if (!next) die('--ledger requires a value');
        out.ledger = next;
        i += 1;
        break;
      case '--stuck-opened-days':
        if (!next) die('--stuck-opened-days requires a value');
        out.stuckOpenedDays = Number(next);
        if (!Number.isFinite(out.stuckOpenedDays) || out.stuckOpenedDays < 0) {
          die('--stuck-opened-days must be a non-negative number');
        }
        i += 1;
        break;
      case '--json':
        out.json = true;
        break;
      case '--help':
      case '-h':
        process.stdout.write(GATE_CHECK_USAGE);
        process.exit(0);
        break;
      default:
        die(`unknown gate-check option: ${arg}`);
    }
  }
  if (!out.chain) die('--chain <chain-id> is required');
  return out;
}

function formatHumanResult(chain, result) {
  const lines = [];
  if (result.ok) {
    lines.push(`PASS chain=${chain} blockers=0 passing=${result.passing_rows}/${result.total_rows} ledger=${result.ledger_path}`);
    if (result.empty_ledger) {
      lines.push('  (empty ledger — v1 no-op mode; gate clears by default)');
    }
    if (result.malformed_lines > 0) {
      lines.push(`  warn: ${result.malformed_lines} malformed line(s) in ledger`);
    }
    return lines.join('\n') + '\n';
  }
  lines.push(`BLOCK chain=${chain} blockers=${result.blockers.length} passing=${result.passing_rows}/${result.total_rows} ledger=${result.ledger_path}`);
  for (const b of result.blockers) {
    const id = b.opportunity_id ?? '<no-id>';
    const target = [b.target_utility, b.target_export].filter(Boolean).join('/');
    const site = b.call_site_file ? `${b.call_site_file}:${b.call_site_line ?? '?'}` : '';
    const age = b.age_days !== undefined ? ` age=${b.age_days.toFixed(1)}d` : '';
    const targetPart = target ? ` target=${target}` : '';
    const sitePart = site ? ` site=${site}` : '';
    lines.push(`  - ${id} state=${b.state} reason=${b.reason}${age}${targetPart}${sitePart}`);
  }
  if (result.malformed_lines > 0) {
    lines.push(`  warn: ${result.malformed_lines} malformed line(s) in ledger`);
  }
  lines.push(`  override: caia-chain mark-done <phase> --adoption-pending-ok --reason "<why>"`);
  return lines.join('\n') + '\n';
}

function runGateCheck(argv) {
  const opts = parseGateCheckArgs(argv);
  const gateOpts = {};
  if (opts.ledger) gateOpts.ledgerPath = opts.ledger;
  if (opts.stuckOpenedDays !== undefined) gateOpts.stuckOpenedDays = opts.stuckOpenedDays;
  const result = checkAdoptionGate(opts.chain, gateOpts);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ chain: opts.chain, ...result }, null, 2) + '\n');
  } else {
    process.stdout.write(formatHumanResult(opts.chain, result));
  }
  process.exit(result.ok ? 0 : 1);
}

function main() {
  const [, , verb, ...rest] = process.argv;
  if (!verb || verb === '--help' || verb === '-h') {
    process.stdout.write(USAGE);
    process.exit(verb ? 0 : 2);
  }
  switch (verb) {
    case 'gate-check':
      runGateCheck(rest);
      break;
    default:
      die(`unknown verb: ${verb}\n\n${USAGE}`);
  }
}

main();
