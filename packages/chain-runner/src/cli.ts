import { Command } from 'commander';
import { existsSync, unlinkSync } from 'node:fs';
import {
  AcceptanceRefusedError,
  adjudicate,
  computeNextPhase,
  evaluateNextPhase,
  forceFail,
  initState,
  loadContext,
  loadState,
  markDone,
  markFailed,
  markInProgress,
  pause,
  promoteFailedToBlocked,
  reArm,
  recordWake,
  resume,
  saveState,
  setBudget,
  tryLoadState,
} from './state.js';
import { takeStateBackup } from './backup.js';
import type { PhaseStatus } from './types.js';
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
import {
  DEFAULT_BACKOFF_MS,
  DEFAULT_HEALTHZ_ENDPOINTS,
  checkHealthzAll,
  preflightAuditDetails,
  preflightSummary,
  retryWithBackoff,
  summarizeHealthz,
  verifyBootstrap,
} from './bootstrap.js';
import {
  attemptReRegister,
  detectStall,
  recordStallDetected,
} from './watchdog.js';
import { appendAudit } from './audit.js';
import {
  emitAlert,
  type AlertChannel,
  type AlertSeverity,
  type AlertEvent,
} from './alerting.js';
import { diagnoseStall } from './cascade.js';
import { chainPaths } from './paths.js';
import { doctorExitCode, formatDoctorReport, runDoctor } from './doctor.js';
import { formatReapReport, reapOrphans } from './reap.js';
import { fireHandoffRefresh } from './handoff-refresh.js';
import {
  DEFAULT_PROMPT as PREFLIGHT_DEFAULT_PROMPT,
  DEFAULT_TIMEOUT_MS as PREFLIGHT_DEFAULT_TIMEOUT_MS,
  formatPreflightLine,
  preflightDispatch,
} from './preflight.js';
import { spawnSync } from 'node:child_process';

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
    .description(
      'Print the id of the next dispatchable phase. H-21: --read-only skips the failed→blocked promotion (use `promote-blocked` first for the explicit two-step contract).',
    )
    .option(
      '--read-only',
      'evaluate without mutating state.json (no promote, no streak update, no audit emit). Equivalent to evaluateNextPhase(state, spec).',
    )
    .action((cmdOpts: { readOnly?: boolean }, cmd: Command) => {
      const opts = cmd.optsWithGlobals() as BaseOptions;
      const ctx = ctxFromOpts(opts);
      const state = loadState(ctx);
      const result = cmdOpts.readOnly
        ? evaluateNextPhase(state, ctx.spec)
        : computeNextPhase(ctx, state);
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
        case 'backoff':
          // H-9: BACKOFF <seconds> phase=<id> until=<iso>. Wake scripts treat
          // this as noop (log + exit 0).
          process.stdout.write(
            `BACKOFF ${result.seconds} phase=${result.id} until=${result.until}\n`,
          );
          break;
        case 'phase_id':
          process.stdout.write(`${result.id}\n`);
          break;
      }
    });

  // H-21 (chain-runner-battle-harden phase 7, 2026-05-14). promote-blocked is
  // the explicit mutation half of the next-phase decision: walks every failed
  // phase, applies the H-9 retry policy, and flips to `blocked` (with a
  // phase_blocked audit event) when retries are exhausted or the policy
  // action is terminal. Wake scripts call this between check-lock-staleness
  // and next-phase so the read-only next-phase no longer needs to mutate.
  attachCommonOptions(program.command('promote-blocked'))
    .description(
      'Promote every failed phase whose retry policy is exhausted to `blocked`. Wake-script step between check-lock-staleness and next-phase.',
    )
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      const state = loadState(ctx);
      const promoted = promoteFailedToBlocked(ctx, state);
      if (promoted.length === 0) {
        process.stdout.write('PROMOTE_BLOCKED none\n');
      } else {
        process.stdout.write(`PROMOTE_BLOCKED ${promoted.join(',')}\n`);
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
    .option(
      '--skip-acceptance',
      'H-15: skip success_criteria enforcement (escape hatch for adjudication tooling)',
    )
    .description(
      'Transition a phase to done and clear the lock. H-15: validates success_criteria per phase/chain enforce mode (default warn).',
    )
    .action(
      (
        phaseId: string,
        cmdOpts: { skipAcceptance?: boolean },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions;
        const ctx = ctxFromOpts(opts);
        // H-13 (phase 9, 2026-05-14). Snapshot state.json before the mutation
        // so a botched mark-done can be rolled back from .backups/.
        takeStateBackup(ctx);
        const markDoneOpts: Parameters<typeof markDone>[2] = {};
        if (cmdOpts.skipAcceptance) markDoneOpts.skipAcceptance = true;
        try {
          markDone(ctx, phaseId, markDoneOpts);
        } catch (err) {
          if (err instanceof AcceptanceRefusedError) {
            process.stderr.write(
              `ACCEPTANCE_REFUSED phase=${phaseId} enforce=${err.result.enforce} summary=${err.result.summary}\n`,
            );
            // Distinct exit code (9) so wake scripts / wrappers can detect
            // strict-mode refusal vs generic errors.
            process.exit(9);
          }
          throw err;
        }
        clearLock(ctx);
        // Event-triggered SESSION_HANDOFF.md refresh closes the staleness gap
        // between hourly cron ticks (red-flag-remediation phase 5, 2026-05-14).
        fireHandoffRefresh({
          triggeredBy: `chain-phase-done-${opts.chainId}-${phaseId}`,
        });
      },
    );

  attachCommonOptions(program.command('mark-failed'))
    .argument('<phase-id>')
    .argument('[reason...]')
    .option(
      '--class <class>',
      'FailureClass (e.g. worker_no_start_rate_limit, worker_hung_post_success); default `unknown`',
    )
    .option(
      '--evidence <kv>',
      'one or more key=value evidence pairs (repeatable, comma-separated)',
      (val: string, acc: string[]) => acc.concat(val),
      [] as string[],
    )
    .description(
      'Transition a phase to failed and clear the lock. Legacy string reason still accepted (becomes class=unknown).',
    )
    .action(
      (
        phaseId: string,
        reason: string[],
        cmdOpts: { class?: string; evidence?: string[] },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions;
        const ctx = ctxFromOpts(opts);
        // H-13 backup-before-mutate.
        takeStateBackup(ctx);
        const r = reason.length > 0 ? reason.join(' ') : 'no_reason';
        if (cmdOpts.class) {
          const evidence: Record<string, unknown> = {
            source: 'cli_mark_failed',
          };
          for (const kv of cmdOpts.evidence ?? []) {
            for (const piece of kv.split(',')) {
              const eq = piece.indexOf('=');
              if (eq > 0) {
                evidence[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
              }
            }
          }
          markFailed(ctx, phaseId, {
            class: cmdOpts.class as never,
            reason: r,
            detected_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            evidence,
          });
        } else {
          // Back-compat shim — string reason, classifier coerces to unknown.
          markFailed(ctx, phaseId, r);
        }
        clearLock(ctx);
      },
    );

  // H-8 (chain-runner-battle-harden phase 7, 2026-05-14). Adjudication verbs.
  // Replace operator hand-edits of state.json with sanctioned, audited
  // transitions. See state.ts:adjudicate / reArm / forceFail for semantics.
  //
  // Reason is REQUIRED non-empty. Backups land in <chain-dir>/.backups/.
  // Every transition emits a structured audit event and fires the
  // SESSION_HANDOFF refresh hook.
  attachCommonOptions(program.command('adjudicate'))
    .argument('<phase-id>')
    .requiredOption(
      '--to <state>',
      'target state: pending | in_progress | failed | blocked | done',
    )
    .requiredOption('--reason <text>', 'operator-supplied reason (required, non-empty)')
    .option(
      '--evidence <kv>',
      'key=value evidence pair (repeatable, e.g. --evidence pr=https://...)',
      (val: string, acc: string[]) => acc.concat(val),
      [] as string[],
    )
    .option(
      '--strict',
      'refuse adjudicate --to done when no pr/artifact/verification evidence supplied',
    )
    .description(
      'Adjudicate a phase to an arbitrary state. Writes a state.json backup, validates the transition, emits a phase_adjudicated audit event, and refreshes SESSION_HANDOFF.',
    )
    .action(
      (
        phaseId: string,
        cmdOpts: {
          to: string;
          reason: string;
          evidence?: string[];
          strict?: boolean;
        },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions;
        const ctx = ctxFromOpts(opts);
        // H-13 (phase 9) rolling LRU snapshot in addition to the labeled
        // adjudicate-suffix backup that state.ts:adjudicate writes via
        // writeStateBackup. Both serve different purposes — the labeled
        // one is referenced from the audit event; the rolling one is the
        // generic safety net pruned to last 20.
        takeStateBackup(ctx);
        const evidence: Record<string, unknown> = {};
        for (const kv of cmdOpts.evidence ?? []) {
          // Use only the first '=' so URLs (which contain '=') survive intact.
          const eq = kv.indexOf('=');
          if (eq > 0) {
            evidence[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim();
          }
        }
        const adjudicateOpts: Parameters<typeof adjudicate>[4] = {
          evidence,
        };
        if (cmdOpts.strict) adjudicateOpts.strict = true;
        try {
          const r = adjudicate(
            ctx,
            phaseId,
            cmdOpts.to as PhaseStatus,
            cmdOpts.reason,
            adjudicateOpts,
          );
          process.stdout.write(
            `ADJUDICATED phase=${phaseId} from=${r.from} to=${r.to} backup=${r.backup}\n`,
          );
        } catch (err) {
          fail((err as Error).message);
        }
      },
    );

  attachCommonOptions(program.command('re-arm'))
    .argument('<phase-id>')
    .requiredOption('--reason <text>', 'operator-supplied reason (required, non-empty)')
    .option('--reset-attempts', 'set ps.attempts back to 0 alongside the status flip')
    .option('--force', 'lift the blocked-only guard (allow re-arm from non-blocked states)')
    .description(
      'Lift a phase from `blocked` back to `pending`. Writes a state.json backup, emits phase_rearmed, refreshes SESSION_HANDOFF.',
    )
    .action(
      (
        phaseId: string,
        cmdOpts: { reason: string; resetAttempts?: boolean; force?: boolean },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions;
        const ctx = ctxFromOpts(opts);
        // H-13: rolling backup alongside re-arm's labeled backup.
        takeStateBackup(ctx);
        const reArmOpts: Parameters<typeof reArm>[3] = {};
        if (cmdOpts.resetAttempts) reArmOpts.resetAttempts = true;
        if (cmdOpts.force) reArmOpts.force = true;
        try {
          const r = reArm(ctx, phaseId, cmdOpts.reason, reArmOpts);
          process.stdout.write(
            `REARMED phase=${phaseId} from=${r.from} attempts=${r.attemptsBefore}->${r.attemptsAfter} backup=${r.backup}\n`,
          );
        } catch (err) {
          fail((err as Error).message);
        }
      },
    );

  attachCommonOptions(program.command('force-fail'))
    .argument('<phase-id>')
    .requiredOption('--reason <text>', 'operator-supplied reason (required, non-empty)')
    .description(
      'Operator-mark a phase as failed (class=unknown, source=operator_force_fail). Writes a backup, emits phase_force_failed, refreshes SESSION_HANDOFF.',
    )
    .action(
      (phaseId: string, cmdOpts: { reason: string }, cmd: Command) => {
        const opts = cmd.optsWithGlobals() as BaseOptions;
        const ctx = ctxFromOpts(opts);
        // H-13: rolling backup alongside force-fail's labeled backup.
        takeStateBackup(ctx);
        try {
          const r = forceFail(ctx, phaseId, cmdOpts.reason);
          process.stdout.write(
            `FORCE_FAILED phase=${phaseId} from=${r.from} backup=${r.backup}\n`,
          );
        } catch (err) {
          fail((err as Error).message);
        }
      },
    );

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
    .option(
      '--dispatch-log <path>',
      "path to the worker's dispatch log; classifier sniffs it for rate-limit / auth / spawn signals",
    )
    .description('Clear stale lock if heartbeat or runtime cap exceeded')
    .action(
      (cmdOpts: { dispatchLog?: string }, cmd: Command) => {
        const opts = cmd.optsWithGlobals() as BaseOptions;
        const ctx = ctxFromOpts(opts);
        const r = checkLockStaleness(ctx, {
          dispatchLogPath: cmdOpts.dispatchLog ?? null,
        });
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
              `STALE_LOCK_CLEARED phase=${r.phaseId} reason=${r.reason} class=${r.failure.class} ${detail}\n`,
            );
            break;
          }
          case 'auto_adjudicated':
            process.stdout.write(
              `PHASE_AUTO_ADJUDICATED phase=${r.phaseId} class=${r.failure.class} age=${Math.floor(r.ageSec)}s\n`,
            );
            // Auto-adjudication is a success-shaped transition; refresh
            // SESSION_HANDOFF so the operator sees the new state.
            fireHandoffRefresh({
              triggeredBy: `chain-phase-auto-adjudicated-${opts.chainId}-${r.phaseId}`,
            });
            break;
        }
      },
    );

  attachCommonOptions(program.command('pause'))
    .option('--reason <text>', 'reason (persisted to state.paused_reason)')
    .option(
      '--until <iso>',
      'ISO timestamp; wake-script shim auto-resumes once now >= until',
    )
    .description('Suppress further dispatch until resume')
    .action(
      (
        cmdOpts: { reason?: string; until?: string },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions;
        const ctx = ctxFromOpts(opts);
        // H-13 backup-before-mutate.
        takeStateBackup(ctx);
        const pauseOpts: { reason?: string; pausedUntil?: string } = {};
        if (cmdOpts.reason !== undefined) pauseOpts.reason = cmdOpts.reason;
        if (cmdOpts.until !== undefined) pauseOpts.pausedUntil = cmdOpts.until;
        pause(ctx, pauseOpts);
        const suffix = cmdOpts.until ? ` until=${cmdOpts.until}` : '';
        process.stdout.write(`PAUSED${suffix}\n`);
      },
    );

  attachCommonOptions(program.command('resume'))
    .description('Re-enable dispatch')
    .action((opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      // H-13 backup-before-mutate.
      takeStateBackup(ctx);
      resume(ctx);
      process.stdout.write('RESUMED\n');
    });

  attachCommonOptions(program.command('budget'))
    .argument('<pct>')
    .description('Set budget consumed percentage (0-100)')
    .action((pct: string, opts: BaseOptions) => {
      const ctx = ctxFromOpts(opts);
      // H-13 backup-before-mutate.
      takeStateBackup(ctx);
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

  // H-4 (chain-runner-battle-harden phase 4, 2026-05-14). preflight-dispatch
  // probes the claude binary BEFORE we burn a dispatch slot. Exit codes are
  // contract: 0 healthy, 1 generic, 2 rate_limited, 3 auth_failure, 4 timeout,
  // 5 unknown, 6 api_key_leak. Wake scripts read the exit code + the stdout
  // PREFLIGHT line; the result is also appended to audit.jsonl when --chain-id
  // is supplied.
  program
    .command('preflight-dispatch')
    .description(
      'Probe claude binary before dispatch. Exit codes: 0 healthy, 2 rate_limited, 3 auth_failure, 4 timeout, 5 unknown, 6 api_key_leak.',
    )
    .option('--chain-id <id>', 'chain identifier (audit log destination)')
    .option('--phases <path>', 'path to phases YAML spec (audit log destination)')
    .option('--binary <path>', 'path to claude binary', 'claude')
    .option('--prompt <text>', 'one-shot prompt sent via --print -p', PREFLIGHT_DEFAULT_PROMPT)
    .option(
      '--timeout-ms <n>',
      'overall preflight wallclock timeout (ms)',
      String(PREFLIGHT_DEFAULT_TIMEOUT_MS),
    )
    .option('--log <path>', 'append raw stdout/stderr to this path')
    .option('--allow-api-key', 'do NOT refuse if ANTHROPIC_API_KEY is set (CI tests)')
    .action(
      async (cmdOpts: {
        chainId?: string;
        phases?: string;
        binary?: string;
        prompt?: string;
        timeoutMs?: string;
        log?: string;
        allowApiKey?: boolean;
      }) => {
        const preOpts: Parameters<typeof preflightDispatch>[0] = {
          refuseIfApiKeySet: !cmdOpts.allowApiKey,
        };
        if (cmdOpts.binary) preOpts.binary = cmdOpts.binary;
        if (cmdOpts.prompt) preOpts.prompt = cmdOpts.prompt;
        if (cmdOpts.timeoutMs) preOpts.timeoutMs = Number(cmdOpts.timeoutMs);
        if (cmdOpts.log) preOpts.logPath = cmdOpts.log;
        const r = await preflightDispatch(preOpts);
        process.stdout.write(`${formatPreflightLine(r)}\n`);
        // Audit if a chain context is available (chain-id + phases required).
        if (cmdOpts.chainId && cmdOpts.phases) {
          try {
            const ctx = loadContext(cmdOpts.chainId, cmdOpts.phases);
            const audit: Record<string, unknown> = {
              status: r.status,
              exit_code: r.exit_code,
              elapsed_ms: r.elapsed_ms,
              message: r.message.slice(0, 500),
            };
            if (r.reset_iso) audit['reset_iso'] = r.reset_iso;
            if (r.reset_banner) audit['reset_banner'] = r.reset_banner;
            appendAudit(ctx.paths.auditFile, 'preflight_dispatch', audit);
          } catch {
            // ignore — audit is a convenience, not load-bearing.
          }
        }
        // 0/1/2/3/4/5/6
        process.exit(r.exit_code);
      },
    );

  attachCommonOptions(program.command('dispatch'))
    .argument('<phase-id>')
    .option('--spawn <command>', 'background command to spawn (receives PHASE_ID SESSION_ID PROMPT_FILE)')
    .option(
      '--early-exit-window-ms <n>',
      'window (ms) to watch for an immediate child exit; default 5000',
    )
    .description('Build the prompt file, mark in_progress, acquire lock, optionally spawn a runner')
    .action(
      async (
        phaseId: string,
        cmdOpts: { spawn?: string; earlyExitWindowMs?: string },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions & {
          spawn?: string;
          earlyExitWindowMs?: string;
        };
        const ctx = ctxFromOpts(opts);
        // Validate the phase exists in the spec
        findPhase(ctx.spec, Number(phaseId));
        const dispatchOpts = cmdOpts.spawn
          ? {
              command: cmdOpts.spawn,
              args: [] as string[],
              ...(cmdOpts.earlyExitWindowMs
                ? { earlyExitWindowMs: Number(cmdOpts.earlyExitWindowMs) }
                : {}),
            }
          : undefined;
        const result = await dispatchPhase(ctx, Number(phaseId), dispatchOpts);
        process.stdout.write(
          `dispatched phase=${result.phaseId} session=${result.sessionId} prompt=${result.promptFile}` +
            (result.pid ? ` pid=${result.pid}` : '') +
            (result.logFile ? ` log=${result.logFile}` : '') +
            '\n',
        );
        // Surface H-3 early-exit signal on stderr+exit code so wake scripts
        // can react without parsing stdout.
        if (typeof result.early_exit_code === 'number') {
          const cls = result.early_failure?.class ?? 'graceful';
          process.stderr.write(
            `EARLY_EXIT phase=${result.phaseId} exit_code=${result.early_exit_code} class=${cls}\n`,
          );
          if (result.early_failure) {
            // Distinct exit code so the wake script can fall through to
            // its own backoff / classification log without treating this as
            // a generic dispatch error.
            process.exit(7);
          }
        }
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/consistent-type-imports
      const fs = require('node:fs') as typeof import('node:fs');
      const lines = fs.readFileSync(ctx.paths.auditFile, 'utf8').trimEnd().split('\n');
      const n = Number(opts.n ?? '20');
      for (const line of lines.slice(-n)) {
        process.stdout.write(`${line}\n`);
      }
    });

  attachCommonOptions(program.command('verify-bootstrap'))
    .description(
      'Block until a wake event lands in audit.jsonl or timeout. Use after registering a scheduled task to prove cron is firing. Also pre-flights healthz of mentor + router; exits 3 if either is unhealthy.',
    )
    .option(
      '--wake-interval-sec <n>',
      'configured wake interval (seconds)',
      '900',
    )
    .option(
      '--max-wait-sec <n>',
      'total wait timeout (seconds); default 2 * wake-interval-sec',
    )
    .option(
      '--poll-interval-sec <n>',
      'how often to poll audit.jsonl (seconds)',
      '10',
    )
    .option('--skip-healthz', 'skip mentor/router healthz pre-flight (CI / tests)')
    .option(
      '--healthz-timeout-ms <n>',
      'per-endpoint healthz timeout (ms)',
      '2000',
    )
    .action(
      async (
        cmdOpts: {
          wakeIntervalSec?: string;
          maxWaitSec?: string;
          pollIntervalSec?: string;
          skipHealthz?: boolean;
          healthzTimeoutMs?: string;
        },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions & typeof cmdOpts;
        const ctx = ctxFromOpts(opts);

        // Healthz pre-flight: refuse to declare bootstrap healthy if either
        // the mentor event-bus or the local-llm-router is dark. See
        // src/bootstrap.ts:DEFAULT_HEALTHZ_ENDPOINTS for rationale.
        if (!cmdOpts.skipHealthz) {
          const timeoutMs = Number(cmdOpts.healthzTimeoutMs ?? '2000');
          const results = await checkHealthzAll(DEFAULT_HEALTHZ_ENDPOINTS, {
            timeoutMs,
          });
          const summary = summarizeHealthz(results);
          process.stdout.write(`HEALTHZ ${summary}\n`);
          appendAudit(ctx.paths.auditFile, 'preflight_healthz', {
            ok: results.every((r) => r.ok),
            results: results.map((r) => ({
              name: r.name,
              url: r.url,
              ok: r.ok,
              status: r.status,
              error: r.error,
              elapsed_ms: r.elapsedMs,
            })),
            stamped_at: new Date().toISOString(),
          });
          const failures = results.filter((r) => !r.ok);
          if (failures.length > 0) {
            const names = failures.map((r) => r.name).join(',');
            process.stderr.write(
              `HEALTHZ_FAIL endpoints=${names} — refusing to declare bootstrap healthy. See \`caia-chain doctor\` for diagnostics.\n`,
            );
            process.exit(3);
          }
        }

        const wakeInterval = Number(cmdOpts.wakeIntervalSec ?? '900');
        const maxWait = Number(cmdOpts.maxWaitSec ?? String(wakeInterval * 2));
        const pollInterval = Number(cmdOpts.pollIntervalSec ?? '10');
        const since = new Date();
        const result = await verifyBootstrap(ctx, {
          maxWaitMs: maxWait * 1000,
          pollIntervalMs: pollInterval * 1000,
          since,
        });
        appendAudit(ctx.paths.auditFile, 'preflight_verified', preflightAuditDetails(result));
        process.stdout.write(`${preflightSummary(result)}\n`);
        if (!result.ok) process.exit(3);
      },
    );

  attachCommonOptions(program.command('check-stall'))
    .description(
      'Self-healing watchdog: detect cron stall and (optionally) re-register the scheduled task. H-5: also escalates NONE_ELIGIBLE stalls via --alert-on-streak.',
    )
    .option(
      '--wake-interval-sec <n>',
      'configured wake interval (seconds)',
      '900',
    )
    .option('--multiplier <n>', 'stall threshold = multiplier * wake-interval', '2')
    .option('--inbox <path>', 'path to INBOX.md to append alert')
    .option('--reregister-cmd <cmd>', 'shell command to re-register the scheduled task on stall')
    .option('--no-alert', 'suppress INBOX append even when --inbox is given')
    .option(
      '--alert-on-streak <n>',
      'H-5: if state.none_eligible_streak >= n, emit a chain_stalled alert (channels honor chain_config.alert_channels; default [handoff,inbox,notification,audit]) and return STREAK_ALERT_FIRED. Use 2 for the 30-min escalation default.',
    )
    .action(
      (
        cmdOpts: {
          wakeIntervalSec?: string;
          multiplier?: string;
          inbox?: string;
          reregisterCmd?: string;
          alert?: boolean;
          alertOnStreak?: string;
        },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions & typeof cmdOpts;
        const ctx = ctxFromOpts(opts);
        const state = loadState(ctx);

        // H-5: NONE_ELIGIBLE streak escalation. Decoupled from the cron-stall
        // path — both can fire in the same tick, but they describe different
        // failure modes. The streak is owned by computeNextPhase; check-stall
        // just READS it and decides whether to escalate.
        const streakThreshold = cmdOpts.alertOnStreak
          ? Number(cmdOpts.alertOnStreak)
          : null;
        let streakFired = false;
        if (streakThreshold !== null && Number.isFinite(streakThreshold)) {
          const streak = state.none_eligible_streak ?? 0;
          if (streak >= streakThreshold) {
            const diag = diagnoseStall(ctx.spec, state);
            const configChannels = ctx.spec.chain_config?.alert_channels;
            const alertEvent: AlertEvent = {
              type: 'chain_stalled',
              severity: 'high',
              title: `chain_stalled — ${opts.chainId} (streak=${streak})`,
              detail: diag.diagnosis,
              chain: opts.chainId,
              evidence: {
                streak,
                threshold: streakThreshold,
                next_pending_id: diag.nextPending?.id ?? null,
                next_pending_name: diag.nextPending?.name ?? null,
                blocker_id: diag.blocker?.id ?? null,
                blocker_status: diag.blockerState?.status ?? null,
                blocker_class:
                  diag.blockerState?.last_failure_class ??
                  diag.blockerState?.failure?.class ??
                  null,
                blocker_attempts: diag.blockerState?.attempts ?? null,
                suggested: diag.suggested,
              },
            };
            const emitOpts: Parameters<typeof emitAlert>[2] = {
              auditFile: ctx.paths.auditFile,
            };
            if (cmdOpts.inbox) emitOpts.inboxPath = cmdOpts.inbox;
            if (configChannels) emitOpts.configChannels = configChannels;
            const r = emitAlert(undefined, alertEvent, emitOpts);
            streakFired = r.fired.length > 0;
            process.stdout.write(
              `STREAK_ALERT streak=${streak} threshold=${streakThreshold} fired=${r.fired.join(',') || 'none'} deduped=${r.deduped}\n`,
            );
          }
        }

        const result = detectStall(state, {
          wakeIntervalSec: Number(cmdOpts.wakeIntervalSec ?? '900'),
          multiplier: Number(cmdOpts.multiplier ?? '2'),
        });
        if (!result.stalled) {
          process.stdout.write(
            `HEALTHY age_sec=${Math.floor(result.ageSec)} threshold_sec=${result.thresholdSec}\n`,
          );
          // Streak alert is its own exit signal; cron-healthy and streak-fired
          // can coexist (a chain that's waking every 15 min but stalling on
          // NONE_ELIGIBLE).
          if (streakFired) process.exit(5);
          return;
        }
        const inboxPath =
          cmdOpts.alert === false ? undefined : cmdOpts.inbox;
        recordStallDetected(ctx, result, {
          ...(inboxPath ? { inboxPath } : {}),
          chainId: opts.chainId,
        });
        let reregOutput = '';
        if (cmdOpts.reregisterCmd) {
          const reReg = attemptReRegister(
            { command: '/bin/sh', args: ['-c', cmdOpts.reregisterCmd] },
            ctx,
          );
          reregOutput = ` reregister_attempted=${reReg.attempted} reregister_ok=${reReg.ok}`;
        }
        process.stdout.write(
          `STALL_DETECTED age_sec=${Math.floor(result.ageSec)} threshold_sec=${result.thresholdSec} reason=${result.reason}${reregOutput}\n`,
        );
        process.exit(4);
      },
    );

  // H-10 (phase 5, 2026-05-14). emit-alert — generic CLI entry point to the
  // alerting backbone. Used by:
  //   - autonomy directive — workers running into operator-only carve-outs
  //     (`caia-chain emit-alert --type operator_action_required ...`)
  //   - shell wake scripts that want the unified dedupe/handoff/inbox/notify
  //     fan-out instead of the legacy wake_emit_alert bash helper
  //   - external watchdogs (chain-watchdog/watchdog.js) escalating cron stalls
  //
  // chain-id is REQUIRED (load-bearing for the fingerprint dedupe). --phases
  // is OPTIONAL — when given, the alert is also appended to the chain's
  // audit.jsonl via the audit channel; when omitted, the audit channel is
  // suppressed and the chain dir is derived from `chainPaths(chainId)` so the
  // dedupe key still works.
  program
    .command('emit-alert')
    .description(
      'Emit an alert through the unified backbone (handoff + inbox + notification + audit). Required for the autonomy directive `OPERATOR_ACTION_REQUIRED` flow.',
    )
    .requiredOption('--chain-id <id>', 'chain identifier (load-bearing for dedupe fingerprint)')
    .requiredOption(
      '--type <type>',
      'alert type (chain_stalled | chain_rate_limited | chain_auth_failed | operator_action_required | chain_preflight_failed | chain_doctor_degraded | cron_stall_detected | <custom>)',
    )
    .requiredOption('--severity <level>', 'low | medium | high | critical')
    .requiredOption('--detail <text>', 'short human-readable detail string')
    .option('--phases <path>', 'phases YAML — when given, the audit channel logs onto chain audit.jsonl')
    .option('--title <text>', 'optional alert title (defaults to "<type> — <chain-id>")')
    .option(
      '--channels <csv>',
      'override channels: csv of handoff|inbox|notification|audit',
    )
    .option('--force', 'bypass the 6h dedupe (use sparingly)')
    .option(
      '--evidence <kv>',
      'key=value evidence pairs (repeatable)',
      (val: string, acc: string[]) => acc.concat(val),
      [] as string[],
    )
    .action(
      (cmdOpts: {
        chainId: string;
        type: string;
        severity: string;
        detail: string;
        phases?: string;
        title?: string;
        channels?: string;
        force?: boolean;
        evidence?: string[];
      }) => {
        const severity = cmdOpts.severity as AlertSeverity;
        const evidence: Record<string, unknown> = {};
        for (const kv of cmdOpts.evidence ?? []) {
          for (const piece of kv.split(',')) {
            const eq = piece.indexOf('=');
            if (eq > 0) {
              evidence[piece.slice(0, eq).trim()] = piece.slice(eq + 1).trim();
            }
          }
        }
        const event: AlertEvent = {
          type: cmdOpts.type,
          severity,
          title: cmdOpts.title ?? `${cmdOpts.type} — ${cmdOpts.chainId}`,
          detail: cmdOpts.detail,
          chain: cmdOpts.chainId,
          evidence,
          ...(cmdOpts.force ? { force: true } : {}),
        };
        const channels = cmdOpts.channels
          ? (cmdOpts.channels
              .split(',')
              .map((c) => c.trim())
              .filter(Boolean) as AlertChannel[])
          : undefined;

        // Audit file: derive from phases YAML if available (canonical context),
        // else from chainPaths so we still get an audit trail per chain.
        let auditFile: string | undefined;
        let configChannels: string[] | undefined;
        if (cmdOpts.phases) {
          try {
            const ctx = loadContext(cmdOpts.chainId, cmdOpts.phases);
            auditFile = ctx.paths.auditFile;
            configChannels = ctx.spec.chain_config?.alert_channels;
          } catch {
            // Fall through; audit-channel will be suppressed if no path.
          }
        }
        if (!auditFile) {
          try {
            auditFile = chainPaths(cmdOpts.chainId).auditFile;
          } catch {
            // chain-id failed validation; emitAlert will throw later if needed.
          }
        }

        const emitOpts: Parameters<typeof emitAlert>[2] = {};
        if (auditFile) emitOpts.auditFile = auditFile;
        if (configChannels) emitOpts.configChannels = configChannels;
        const r = emitAlert(channels, event, emitOpts);
        process.stdout.write(
          `ALERT_EMIT type=${event.type} chain=${event.chain} fired=${r.fired.join(',') || 'none'} suppressed=${r.suppressed.join(',') || 'none'} deduped=${r.deduped} fp=${r.fingerprint}\n`,
        );
        if (r.deduped) process.exit(8); // distinct exit so callers can detect dedupe
      },
    );

  // H-5 / H-17. stall-root-cause — read-only inspection that walks the
  // dependency graph from the first non-`done` phase and reports the
  // upstream blocker + a suggested adjudication command. Used by operators
  // running `caia-chain stall-root-cause --chain-id ...` after seeing a
  // chain_stalled alert.
  attachCommonOptions(program.command('stall-root-cause'))
    .description(
      'Walk the dependency graph from the first non-done phase and print the upstream blocker plus a suggested adjudication command.',
    )
    .option('--json', 'emit JSON instead of text')
    .action(
      (cmdOpts: { json?: boolean }, cmd: Command) => {
        const opts = cmd.optsWithGlobals() as BaseOptions & typeof cmdOpts;
        const ctx = ctxFromOpts(opts);
        const state = loadState(ctx);
        const diag = diagnoseStall(ctx.spec, state);
        if (cmdOpts.json) {
          process.stdout.write(
            JSON.stringify(
              {
                chain_id: opts.chainId,
                next_pending: diag.nextPending
                  ? { id: diag.nextPending.id, name: diag.nextPending.name }
                  : null,
                blocker: diag.blocker
                  ? { id: diag.blocker.id, name: diag.blocker.name }
                  : null,
                blocker_state: diag.blockerState
                  ? {
                      status: diag.blockerState.status,
                      attempts: diag.blockerState.attempts,
                      class:
                        diag.blockerState.last_failure_class ??
                        diag.blockerState.failure?.class ??
                        null,
                      reason:
                        diag.blockerState.failure?.reason ??
                        diag.blockerState.error ??
                        null,
                    }
                  : null,
                diagnosis: diag.diagnosis,
                suggested: diag.suggested,
                none_eligible_streak: state.none_eligible_streak ?? 0,
              },
              null,
              2,
            ) + '\n',
          );
        } else {
          process.stdout.write(`STALL_ROOT_CAUSE chain=${opts.chainId}\n`);
          process.stdout.write(`  diagnosis: ${diag.diagnosis}\n`);
          process.stdout.write(`  suggested: ${diag.suggested}\n`);
          process.stdout.write(
            `  none_eligible_streak: ${state.none_eligible_streak ?? 0}\n`,
          );
        }
      },
    );

  // H-6 (chain-runner-battle-harden phase 6, 2026-05-14). reap-orphans walks
  // the process tree, finds claude --print workers whose owning phase has
  // since transitioned out of `in_progress`, and (unless --dry-run) terminates
  // them. Wake scripts call this at the top of each wake — cheap (ps + state
  // read).
  program
    .command('reap-orphans')
    .description(
      'Find claude/bash workers whose owning phase is no longer in_progress and (unless --dry-run) reap them. Returns JSON when --json is set.',
    )
    .option('--dry-run', 'list orphans but do not signal them')
    .option('--chain-id <id>', 'restrict reap to a single chain')
    .option('--json', 'emit machine-readable JSON')
    .option(
      '--term-grace-ms <n>',
      'grace period between SIGTERM and SIGKILL (ms); default 10000',
    )
    .action(
      async (cmdOpts: {
        dryRun?: boolean;
        chainId?: string;
        json?: boolean;
        termGraceMs?: string;
      }) => {
        const reapOpts: Parameters<typeof reapOrphans>[0] = {
          dryRun: cmdOpts.dryRun ?? false,
        };
        if (cmdOpts.chainId) reapOpts.chainId = cmdOpts.chainId;
        if (cmdOpts.termGraceMs) reapOpts.termGraceMs = Number(cmdOpts.termGraceMs);
        const report = await reapOrphans(reapOpts);
        if (cmdOpts.json) {
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        } else {
          process.stdout.write(`${formatReapReport(report)}\n`);
        }
        // Exit 0 even when orphans were found; the report is the signal. Wake
        // scripts treat a non-zero exit as "reap infra broke" rather than
        // "orphans existed".
      },
    );

  program
    .command('doctor')
    .description(
      'On-demand health snapshot: node version, mentor/router healthz, launchd plist state for known labels, last_wake for each chain.',
    )
    .option(
      '--healthz-timeout-ms <n>',
      'per-endpoint healthz timeout (ms)',
      '2000',
    )
    .option('--json', 'emit machine-readable JSON instead of the text table')
    .option('--legacy-only', 'emit only V1 sections (node/healthz/plists/chains)')
    .option('--skip-auth', 'skip auth preflight (faster — does not spawn claude)')
    .action(
      async (cmdOpts: {
        healthzTimeoutMs?: string;
        json?: boolean;
        legacyOnly?: boolean;
        skipAuth?: boolean;
      }) => {
        const report = await runDoctor({
          healthzTimeoutMs: Number(cmdOpts.healthzTimeoutMs ?? '2000'),
          legacyOnly: cmdOpts.legacyOnly ?? false,
          skipAuth: cmdOpts.skipAuth ?? false,
        });
        if (cmdOpts.json) {
          process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        } else {
          process.stdout.write(`${formatDoctorReport(report)}\n`);
        }
        process.exit(doctorExitCode(report));
      },
    );

  program
    .command('retry-cmd')
    .description(
      'Run a shell command with exponential backoff (default 5s, 15s, 45s). Exit code 0 on success, last failure code otherwise.',
    )
    .option(
      '--backoff-ms <csv>',
      'comma-separated delays in ms (default 5000,15000,45000)',
    )
    .option('--max-attempts <n>', 'override max attempts')
    .argument('<command...>')
    .action(
      async (
        command: string[],
        cmdOpts: { backoffMs?: string; maxAttempts?: string },
      ) => {
        if (command.length === 0) fail('retry-cmd requires a command');
        const backoff = cmdOpts.backoffMs
          ? cmdOpts.backoffMs.split(',').map((s) => Number(s.trim()))
          : Array.from(DEFAULT_BACKOFF_MS);
        const maxAttempts = cmdOpts.maxAttempts
          ? Number(cmdOpts.maxAttempts)
          : undefined;
        let lastCode: number | null = null;
        let lastStderr = '';
        try {
          await retryWithBackoff(
            () => {
              const out = spawnSync(command[0]!, command.slice(1), {
                stdio: ['ignore', 'inherit', 'pipe'],
              });
              lastCode = out.status;
              lastStderr = out.stderr ? out.stderr.toString('utf8') : '';
              if (out.status !== 0) {
                throw new Error(
                  `exit=${out.status} cmd=${command.join(' ').slice(0, 200)}`,
                );
              }
              return out.status;
            },
            {
              backoffMs: backoff,
              ...(maxAttempts !== undefined ? { maxAttempts } : {}),
              onRetry: (attempt, err, delayMs) => {
                process.stderr.write(
                  `retry-cmd attempt ${attempt} failed (${(err as Error).message}); sleeping ${delayMs}ms\n`,
                );
              },
            },
          );
          process.stdout.write('RETRY_OK\n');
        } catch (err) {
          if (lastStderr) process.stderr.write(lastStderr);
          process.stderr.write(`RETRY_EXHAUSTED ${(err as Error).message}\n`);
          process.exit(lastCode ?? 5);
        }
      },
    );

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
