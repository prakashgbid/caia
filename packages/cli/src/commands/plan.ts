import type { Command } from 'commander';

/**
 * `caia plan <prompt-text>` — submit a prompt in plan-only run mode.
 *
 * Plan-only runs the full decomposition pipeline (PO + BA + EA +
 * Validator + Test-Design + Task Manager) but the ReadyPoolConsumer
 * skips worker assignment for plan-only stories. Output is the
 * WorkGraph + per-story architecturalInstructions + estimated
 * tokens/cost. No file writes, no PRs.
 *
 * The CLI POSTs to /api/prompts with `run_mode: "plan-only"`. The
 * orchestrator's response includes the prompt id; users then fetch
 * /api/prompts/<id>/plan-output for the rendered plan once the
 * pipeline completes.
 *
 * RUN-MODES (migration 0038, run-modes/index.ts) is the single source
 * of truth for the run-mode enum.
 */
export function registerPlanCommand(program: Command): void {
  program
    .command('plan')
    .description('Submit a prompt in plan-only mode (no code, no PRs — just the plan + cost)')
    .argument('<prompt...>', 'Prompt text (rest args are joined with spaces)')
    .option('--api <url>', 'Orchestrator API base URL', 'http://localhost:8787')
    .option('--project <id>', 'Project id to attach the prompt to')
    .option('--priority <p>', 'Priority bucket override (P0|P1|P2|P3)')
    .action(async (promptParts: string[], opts: { api: string; project?: string; priority?: string }) => {
      const promptText = promptParts.join(' ').trim();
      if (!promptText) {
        console.error('error: prompt text is required');
        process.exit(2);
      }
      const payload = {
        body: promptText,
        received_via: 'cli',
        run_mode: 'plan-only',
        metadata: {
          ...(opts.project ? { projectId: opts.project } : {}),
          ...(opts.priority ? { priority: opts.priority } : {}),
        },
      };
      try {
        const res = await fetch(`${opts.api}/prompts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = (await res.json()) as { id?: string; error?: string };
        if (!res.ok) {
          console.error(`error: ${data.error ?? `HTTP ${res.status}`}`);
          process.exit(1);
        }
        console.log(`Submitted plan-only prompt ${data.id}`);
        console.log(`  Poll: ${opts.api}/prompts/${data.id}/plan-output`);
      } catch (err) {
        console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
