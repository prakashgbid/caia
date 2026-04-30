import type { Command } from 'commander';

/**
 * `caia test <prompt-text>` — submit a prompt in test-only run mode.
 *
 * Test-only runs the full pipeline AND the Coding Agent (so code is
 * actually written + unit-tested), but the per-run capability
 * allowlist has deploy / publish / push-main capabilities stripped
 * before the capsule is frozen. Nothing is deployed, nothing is
 * published, nothing is pushed to main.
 *
 * Until the Track 1 capability broker is online, this is plumbing-
 * level: the run-mode propagates through the pipeline + capsule, but
 * actual enforcement is best-effort by the Coding Agent. Once the
 * broker lands, the broker reads `stories.run_mode` and applies
 * `restrictAllowlistForMode` from the run-modes module.
 *
 * The CLI POSTs to /api/prompts with `run_mode: "test-only"`.
 */
export function registerTestCommand(program: Command): void {
  program
    .command('test')
    .description('Submit a prompt in test-only mode (writes code, runs tests, but never deploys / publishes / pushes main)')
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
        run_mode: 'test-only',
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
        console.log(`Submitted test-only prompt ${data.id}`);
        console.log(`  Track: ${opts.api}/prompts/${data.id}`);
      } catch (err) {
        console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
