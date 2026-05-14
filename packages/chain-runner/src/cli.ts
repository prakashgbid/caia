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
import { doctorExitCode, formatDoctorReport, runDoctor } from './doctor.js';
import { fireHandoffRefresh } from './handoff-refresh.js';
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
      // Event-triggered SESSION_HANDOFF.md refresh closes the staleness gap
      // between hourly cron ticks (red-flag-remediation phase 5, 2026-05-14).
      fireHandoffRefresh({
        triggeredBy: `chain-phase-done-${opts.chainId}-${phaseId}`,
      });
    });

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
      'Self-healing watchdog: detect cron stall and (optionally) re-register the scheduled task.',
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
    .action(
      (
        cmdOpts: {
          wakeIntervalSec?: string;
          multiplier?: string;
          inbox?: string;
          reregisterCmd?: string;
          alert?: boolean;
        },
        cmd: Command,
      ) => {
        const opts = cmd.optsWithGlobals() as BaseOptions & typeof cmdOpts;
        const ctx = ctxFromOpts(opts);
        const state = loadState(ctx);
        const result = detectStall(state, {
          wakeIntervalSec: Number(cmdOpts.wakeIntervalSec ?? '900'),
          multiplier: Number(cmdOpts.multiplier ?? '2'),
        });
        if (!result.stalled) {
          process.stdout.write(
            `HEALTHY age_sec=${Math.floor(result.ageSec)} threshold_sec=${result.thresholdSec}\n`,
          );
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
    .action(async (cmdOpts: { healthzTimeoutMs?: string; json?: boolean }) => {
      const report = await runDoctor({
        healthzTimeoutMs: Number(cmdOpts.healthzTimeoutMs ?? '2000'),
      });
      if (cmdOpts.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else {
        process.stdout.write(`${formatDoctorReport(report)}\n`);
      }
      process.exit(doctorExitCode(report));
    });

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
