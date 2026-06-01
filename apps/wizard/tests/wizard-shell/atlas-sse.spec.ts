/**
 * Playwright E2E — atlas SSE realtime delivery proof.
 *
 * The wizard's Step-7 page (`/wizard/atlas/[projectId]`) renders the
 * `AtlasWizardClient` which (post-C5) wires `useAtlasSse` against the
 * live HTTP client. The test:
 *
 *   1. Visits the atlas page for an arbitrary projectId.
 *   2. Waits for the SSE-status badge to report `connected`.
 *   3. POSTs a synthetic `atlas.prompt.completed` event onto the
 *      in-process bus via the test-only publish route.
 *   4. Asserts the badge flips to expose `data-last-event-type=
 *      atlas.prompt.completed` *without any polling delay* — the
 *      assert uses Playwright's auto-retry but with a tight timeout
 *      that no polling client could satisfy.
 *
 * This is the end-to-end proof that the new route + hook + event bus
 * deliver real-time without polling. The test-publish endpoint is
 * gated by `ATLAS_SSE_TEST_PUBLISH=1` (set in `playwright.config.ts`
 * webServer env) so prod builds never expose it.
 */
import { test, expect } from '@playwright/test';

const PROJECT_ID = 'proj-c5-atlas-e2e';

test.describe('atlas SSE realtime delivery (C5)', () => {
  test('page renders, SSE connects, server-published event lands within 750ms', async ({
    page,
  }) => {
    await page.goto(`/wizard/atlas/${PROJECT_ID}`);

    // The Step-7 page heading and the AtlasWizardClient root render.
    await expect(page.getByTestId('wizard-step-atlas')).toBeVisible();
    await expect(page.getByTestId('atlas-wizard-client')).toBeVisible();

    // SSE badge reports connected. EventSource open is < 100ms locally,
    // well under the default 5s expect timeout.
    const sseBadge = page.getByTestId('atlas-sse-status');
    await expect(sseBadge).toHaveAttribute('data-connected', '1');

    // Pre-publish: no event delivered yet.
    await expect(sseBadge).toHaveAttribute('data-last-event-type', '');

    // Trigger a synthetic atlas.prompt.completed via the test-only
    // publish route. Same Node process, same in-memory event-bus
    // singleton → the connected EventSource sees the frame instantly.
    const publishStartedAt = Date.now();
    const resp = await page.request.post('/api/atlas/__test/publish', {
      data: {
        type: 'atlas.prompt.completed',
        projectId: PROJECT_ID,
        payload: {
          ticket_id: 't-e2e-1',
          prompt_group_id: 'pg-e2e-1',
          result: 'ok',
          version_id: 'tv-e2e-1',
          ts: new Date().toISOString(),
        },
      },
    });
    expect(resp.ok()).toBe(true);

    // The badge MUST reflect the event well before any conceivable
    // poll would have fired — 750ms is a generous bound; the actual
    // round-trip is single-digit ms.
    await expect(sseBadge).toHaveAttribute(
      'data-last-event-type',
      'atlas.prompt.completed',
      { timeout: 750 },
    );

    const elapsed = Date.now() - publishStartedAt;
    // Belt-and-braces: encode the realtime contract in the assertion
    // itself. If a future regression introduces polling, this will
    // start to flake before it silently slows down.
    expect(elapsed).toBeLessThan(750);
  });

  test('only the project-scoped subscriber receives an event', async ({ page }) => {
    await page.goto(`/wizard/atlas/${PROJECT_ID}`);
    const sseBadge = page.getByTestId('atlas-sse-status');
    await expect(sseBadge).toHaveAttribute('data-connected', '1');
    await expect(sseBadge).toHaveAttribute('data-last-event-type', '');

    // Publish for a DIFFERENT project — the page's SSE subscription
    // should ignore it.
    const resp = await page.request.post('/api/atlas/__test/publish', {
      data: {
        type: 'atlas.element.highlighted',
        projectId: 'some-other-project',
        payload: {
          ticket_id: 't-xx',
          dom_id: '#xx',
          design_version_id: 'dv-xx',
          ts: new Date().toISOString(),
        },
      },
    });
    expect(resp.ok()).toBe(true);

    // Negative wait — 500ms is long enough that any deliverer would
    // have fired by now.
    await page.waitForTimeout(500);
    await expect(sseBadge).toHaveAttribute('data-last-event-type', '');
  });
});
