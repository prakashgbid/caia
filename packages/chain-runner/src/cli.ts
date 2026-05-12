import { Command } from 'commander';
import { existsSync, unlinkSync } from 'node:fs';
import {
  computeNextPhase,
  initState,
  loadContext,
  loadState,
  markDone,
  markFailed,
  markInProgress,
  pause,
  recordWake,
  resume,
  saveState,
  setBudget,
  tryLoadState,
} from './state.js';
import {
  HEARTBEAT_GRACE_SEC,
  acquireLock,
  checkLockStaleness,
  clearLock,
  heartbeat,
  loadLock,
} from './lock.js';
import { dispatchPhase } from './runner.js';
import { findPhase } from './spec.js';

interface BaseOptions {
  chainId: string;
  phases: string;
}

function ctxFromOpts(opts: BaseOptions) {
  return loadContext(opts.chainId, opts.phases);
}

function fail(msg: string, code = 2): never {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function attachCommonOptions(cmd: Command): Command {
  return cmd
    .requiredOption('--chain-id <id>', 'chain identifier (folder under ~/.caia/chain/)')
    .requiredOption('--phases <path>', 'path to phases YAML spec');
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('caia-chain')
    .description('Multi-phase chain runner — atomic state, lockfile, audit, dispatch.')
    .version('0.1.0');

  attachCommonOptions(program.command('init'))
    .description('Create initial state file if missing')
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      if (existsSync(ctx.paths.stateFile)) {
        process.stdout.write('ALREADY_INITIALIZED\n');
        return;
      }
      initState(ctx);
      process.stdout.write('INITIALIZED\n');
    });

  attachCommonOptions(program.command('force-init'))
    .description('Delete state + lock and re-init (for tests)')
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      for (const f of [ctx.paths.stateFile, ctx.paths.lockFile]) {
        if (existsSync(f)) unlinkSync(f);
      }
      initState(ctx);
      process.stdout.write('FORCE_INITIALIZED\n');
    });

  attachCommonOptions(program.command('status'))
    .description('Print state machine summary')
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      const state = loadState(ctx);
      const lock = loadLock(ctx);
      process.stdout.write(`started_at:        ${state.started_at}\n`);
      process.stdout.write(`last_wake:         ${state.last_wake ?? 'never'}\n`);
      process.stdout.write(`paused:            ${state.paused}\n`);
      process.stdout.write(
        `budget:            ${state.budget_consumed_pct}% / cap ${state.budget_cap_pct}%\n`,
      );
      process.stdout.write(`current_phase:     ${state.current_phase ?? 'none'}\n`);
      process.stdout.write(`all_done:          ${state.all_done}\n`);
      if (lock) {
        const hbAge = Math.floor(
          (Date.now() - new Date(lock.heartbeat ?? lock.started_at).getTime()) / 1000,
        );
        const stale = hbAge > HEARTBEAT_GRACE_SEC ? 'YES' : 'no';
        process.stdout.write(
          `lock:              phase=${lock.phase_id} session=${lock.session_id.slice(0, 16)} age=${hbAge}s stale=${stale}\n`,
        );
      } else {
        process.stdout.write('lock:              none\n');
      }
      process.stdout.write('\nphase status:\n');
      for (const p of ctx.spec.phases) {
        const ps = state.phase_status[String(p.id)];
        if (!ps) continue;
        const errPart = ps.error ? `  ERROR: ${ps.error.slice(0, 80)}` : '';
        process.stdout.write(
          `  ${String(p.id).padStart(2)} ${p.name.padEnd(40)} ${ps.status.padEnd(12)} attempts=${ps.attempts}${errPart}\n`,
        );
      }
    });

  attachCommonOptions(program.command('next-phase'))
    .description('Print the id of the next dispatchable phase')
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      const state = loadState(ctx);
      const result = computeNextPhase(ctx, state);
      switch (result.kind) {
        case 'paused':
          process.stdout.write('PAUSED\n');
          break;
        case 'budget_exhausted':
          process.stdout.write('BUDGET_EXHAUSTED\n');
          break;
        case 'all_done':
          process.stdout.write('ALL_DONE\n');
          break;
        case 'none_eligible':
          process.stdout.write('NONE_ELIGIBLE\n');
          break;
        case 'in_progress':
          process.stdout.write(`IN_PROGRESS ${result.id}\n`);
          break;
        case 'phase_id':
          process.stdout.write(`${result.id}\n`);
          break;
      }
    });

  attachCommonOptions(program.command('mark-in-progress'))
    .argument('<phase-id>')
    .argument('<session-id>')
    .description('Transition a phase to in_progress and acquire its lock')
    .action((phaseId: string, sessionId: string, opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      markInProgress(ctx, phaseId, sessionId);
      acquireLock(ctx, Number(phaseId), sessionId);
    });

  attachCommonOptions(program.command('mark-done'))
    .argument('<phase-id>')
    .description('Transition a phase to done and clear the lock')
    .action((phaseId: string, opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      markDone(ctx, phaseId);
      clearLock(ctx);
    });

  attachCommonOptions(program.command('mark-failed'))
    .argument('<phase-id>')
    .argument('[reason...]')
    .description('Transition a phase to failed and clear the lock')
    .action((phaseId: string, reason: string[], opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      const r = reason.length > 0 ? reason.join(' ') : 'no_reason';
      markFailed(ctx, phaseId, r);
      clearLock(ctx);
    });

  attachCommonOptions(program.command('heartbeat'))
    .argument('<session-id>')
    .description('Touch the lockfile heartbeat for the given session owner')
    .action((sessionId: string, opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      const r = heartbeat(ctx, sessionId);
      switch (r.kind) {
        case 'no_lock':
          fail('NO_LOCK', 1);
          break;
        case 'owned_by_other':
          fail(`LOCK_OWNED_BY_OTHER ${r.ownerSession}`, 2);
          break;
        case 'ok':
          break;
      }
    });

  attachCommonOptions(program.command('check-lock-staleness'))
    .description('Clear stale lock if heartbeat or runtime cap exceeded')
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      const r = checkLockStaleness(ctx);
      switch (r.kind) {
        case 'no_lock':
          process.stdout.write('NO_LOCK\n');
          break;
        case 'live':
          process.stdout.write(
            `LOCK_LIVE phase=${r.phaseId} hb_age=${Math.floor(r.hbAgeSec)}s run=${Math.floor(r.runSec)}s cap=${r.capSec}s\n`,
          );
          break;
        case 'cleared': {
          const detail =
            r.reason === 'timeout'
              ? `run=${Math.floor(r.ageSec)}s cap=${r.capSec ?? '?'}s`
              : `age=${Math.floor(r.ageSec)}s`;
          process.stdout.write(
            `STALE_LOCK_CLEARED phase=${r.phaseId} reason=${r.reason} ${detail}\n`,
          );
          break;
        }
      }
    });

  attachCommonOptions(program.command('pause'))
    .description('Suppress further dispatch until resume')
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      pause(ctx);
      process.stdout.write('PAUSED\n');
    });

  attachCommonOptions(program.command('resume'))
    .description('Re-enable dispatch')
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      resume(ctx);
      process.stdout.write('RESUMED\n');
    });

  attachCommonOptions(program.command('budget'))
    .argument('<pct>')
    .description('Set budget consumed percentage (0-100)')
    .action((pct: string, opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      setBudget(ctx, Number(pct));
    });

  attachCommonOptions(program.command('wake-observed'))
    .description('Update the last_wake timestamp')
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      // tryLoadState in case the chain is brand new and not yet initialized
      if (!tryLoadState(ctx)) {
        initState(ctx);
      }
      recordWake(ctx);
    });

  attachCommonOptions(program.command('dispatch'))
    .argument('<phase-id>')
    .option('--spawn <command>', 'background command to spawn (receives PHASE_ID SESSION_ID PROMPT_FILE)')
    .description('Build the prompt file, mark in_progress, acquire lock, optionally spawn a runner')
    .action(
      (
        phaseId: string,
        cmdOpts: { spawn?: string },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions & { spawn?: string };
        const ctx = ctxFromOpts(opts);
        // Validate the phase exists in the spec
        findPhase(ctx.spec, Number(phaseId));
        const dispatchOpts = cmdOpts.spawn
          ? { command: cmdOpts.spawn, args: [] as string[] }
          : undefined;
        const result = dispatchPhase(ctx, Number(phaseId), dispatchOpts);
        process.stdout.write(
          `dispatched phase=${result.phaseId} session=${result.sessionId} prompt=${result.promptFile}` +
            (result.pid ? ` pid=${result.pid}` : '') +
            '\n',
        );
      },
    );

  attachCommonOptions(program.command('audit-tail'))
    .option('-n <n>', 'number of trailing audit lines to print', '20')
    .description('Print trailing audit log lines')
    .action((opts: BaseOptions & { n?: string }) => {
      const ctx = ctxFromOpts(opts);
      if (!existsSync(ctx.paths.auditFile)) {
        process.stdout.write('NO_AUDIT\n');
        return;
      }
      // Tail in JS (avoid shelling out)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('node:fs') as typeof import('node:fs');
      const lines = fs.readFileSync(ctx.paths.auditFile, 'utf8').trimEnd().split('\n');
      const n = Number(opts.n ?? '20');
      for (const line of lines.slice(-n)) {
        process.stdout.write(`${line}\n`);
      }
    });

  // Provide a save passthrough (used by some tests)
  attachCommonOptions(program.command('save-state-from-stdin'))
    .description('Read a JSON state from stdin and persist it (test helper)')
    .action(async (opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      saveState(ctx, JSON.parse(raw));
    });

  return program;
}

const program = buildProgram();
const isMain =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('caia-chain.js') ||
    process.argv[1].endsWith('caia-chain') ||
    process.argv[1].endsWith('cli.js'));

if (isMain) {
  program.parseAsync().catch((err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  });
}

export { program };
