/**
 * Playwright E2E — wizard happy path:
 *
 *   /wizard/interview → fake completion (engine returns HANDOFF)
 *       → /wizard/architecture → fake completion (IA accepted)
 *           → /wizard/proposal (sibling-task's route — we just assert it loads).
 *
 * Both step pages expose a `window.__caia*TestApi` escape hatch (set
 * here via `page.addInitScript`) that swaps the server actions for
 * synchronous fakes. This lets the spec run without spawning a real
 * `claude` binary, and without depending on the wizard SHELL or the
 * project-FSM persistence.
 */
import { test, expect } from '@playwright/test';

const sharedInitScript = `
  const baseSession = { interviewId: 'iv_e2e', tenantSlug: 'acme' };
  const fakeCoverage = Object.fromEntries(
    Array.from({ length: 16 }, (_, i) => ['B' + (i + 1), 90])
  );
  window.__caiaWizardTestApi = {
    start: async () => ({
      session: baseSession,
      agentMessage: 'Tell me about your idea.',
      turnNumber: 1,
      state: 'AWAITING_USER',
      coverage: fakeCoverage,
    }),
    submit: async () => ({
      agentMessage: 'Thanks — that completes the interview.',
      turnNumber: 2,
      state: 'HANDOFF',
      coverage: fakeCoverage,
      satisfactionScore: 90,
      handoff: { ok: true },
      complete: true,
    }),
    done: async () => ({
      agentMessage: 'Marked done.',
      turnNumber: 2,
      state: 'FORCE_CLOSED',
      coverage: fakeCoverage,
      satisfactionScore: null,
      handoff: null,
      complete: true,
    }),
    fsm: async () => ({ ok: true, state: 'interview-complete', status: 200 }),
  };
  window.__caiaArchitectureTestApi = {
    runIa: async () => ({
      projectId: 'proj-e2e',
      iaRevisionId: 'iar_e2e',
      writtenAtIso: new Date().toISOString(),
      fsmTransitions: [],
      output: {
        pagesCatalogue: { revisionId: 'pc_e2e', pages: [{ id: 'home' }] },
        designSystem: { revisionId: 'ds_e2e', tokens: { colors: { primary: '#3b82f6' } } },
        componentsLibrary: { revisionId: 'cl_e2e', components: [{ id: 'cmp_a' }] },
      },
    }),
    fsm: async () => ({
      ok: true,
      state: 'information-architecture-complete',
      status: 200,
    }),
  };
`;

test.describe('wizard happy path', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript({ content: sharedInitScript });
    // /wizard/proposal is the sibling task's responsibility; stub it
    // with a minimal HTML body so this spec passes without depending on
    // that work landing first.
    await context.route('**/wizard/proposal*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!doctype html><html><body><div data-testid="wizard-proposal-page">Proposal step</div></body></html>',
      });
    });
  });

  test('interview → architecture → proposal', async ({ page }) => {
    // ─── Step 3: Interview ─────────────────────────────────────────────
    await page.goto('/wizard/interview');
    await expect(page.getByTestId('wizard-interview-page')).toBeVisible();
    await expect(page.getByTestId('turn-agent-1')).toContainText('Tell me about your idea.');

    await page.getByTestId('chat-input').fill('A marketplace for cat-sitters.');
    await page.getByTestId('chat-send').click();

    // The fake submit() returns complete: true / HANDOFF, so the page
    // dispatches FSM, shows the banner, and routes to /wizard/architecture.
    await expect(page.getByTestId('interview-completion-banner')).toBeVisible({
      timeout: 5000,
    });
    await page.waitForURL(/\/wizard\/architecture/, { timeout: 5000 });

    // ─── Step 4: Architecture ──────────────────────────────────────────
    await expect(page.getByTestId('wizard-architecture-page')).toBeVisible();
    await expect(page.getByTestId('generate-ia-button')).toBeVisible();

    await page.getByTestId('generate-ia-button').click();
    await expect(page.getByTestId('ia-artifacts-container')).toBeVisible({
      timeout: 5000,
    });

    await page.getByTestId('accept-ia-button').click();
    await expect(page.getByTestId('ia-completion-banner')).toBeVisible({
      timeout: 5000,
    });

    // ─── Sibling task — /wizard/proposal loads ─────────────────────────
    await page.waitForURL(/\/wizard\/proposal/, { timeout: 5000 });
    await expect(page.getByTestId('wizard-proposal-page')).toBeVisible();
  });

  test('interview "I\'m done" force-closes and routes forward', async ({ page }) => {
    await page.goto('/wizard/interview');
    await expect(page.getByTestId('turn-agent-1')).toBeVisible();
    await page.getByTestId('chat-done').click();
    await expect(page.getByTestId('interview-completion-banner')).toBeVisible({
      timeout: 5000,
    });
    await page.waitForURL(/\/wizard\/architecture/, { timeout: 5000 });
  });
});
