/**
 * Behavior-first assertion helpers that wrap Playwright but speak in user outcomes, not DOM.
 *
 * Design contract:
 * - Tests assert on BEHAVIOR and EXPECTATIONS, not fragile DOM selectors.
 * - `data-test-id` attributes are the only explicit DOM hooks allowed — they are the contract
 *   surface the sites must honor and are stable across redesigns.
 * - If a test breaks because a `div` moved, the test is over-specified — fix the test.
 */

import { expect as pwExpect } from '@playwright/test';
import type { Page, Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { LayoutContract, URLContract, JourneyStep, RegionKey } from './types';
import { REGION_LOCATORS } from './types';

/** Find the first matching locator for a semantic region (tries each strategy in order). */
async function findRegion(page: Page, region: RegionKey): Promise<Locator | null> {
  for (const selector of REGION_LOCATORS[region]) {
    const loc = page.locator(selector).first();
    try {
      const visible = await loc.isVisible({ timeout: 500 });
      if (visible) return loc;
    } catch {
      // try next
    }
  }
  // Return first locator even if not visible, so the caller gets a meaningful error
  return page.locator(REGION_LOCATORS[region][0]).first();
}

/**
 * Assert all required regions in a LayoutContract are present and visible.
 * Stable across DOM changes because it checks semantic structure, not specific classes.
 */
export async function checkLayoutContract(page: Page, contract: LayoutContract): Promise<void> {
  for (const region of contract.must_have) {
    const locators = REGION_LOCATORS[region];
    let found = false;
    for (const selector of locators) {
      try {
        const count = await page.locator(selector).count();
        if (count > 0) { found = true; break; }
      } catch { /* continue */ }
    }
    if (!found) {
      throw new Error(
        `Layout contract violation: region "${region}" not found.\n` +
        `Tried selectors: ${locators.join(', ')}\n` +
        `This means the page is missing a required semantic region — fix the page, not the test.`
      );
    }
  }

  if (contract.footer_link_groups) {
    const match = contract.footer_link_groups.match(/^(>=|<=|>|<|=)(\d+)$/);
    if (match) {
      const [, op, numStr] = match;
      const threshold = parseInt(numStr, 10);
      const footer = page.locator('footer, [role="contentinfo"]').first();
      const linkCount = await footer.locator('a').count();
      const ok = op === '>=' ? linkCount >= threshold
               : op === '<=' ? linkCount <= threshold
               : op === '>'  ? linkCount >  threshold
               : op === '<'  ? linkCount <  threshold
               : linkCount === threshold;
      if (!ok) {
        throw new Error(
          `Layout contract violation: footer link count ${linkCount} does not satisfy ${contract.footer_link_groups}`
        );
      }
    }
  }
}

/**
 * Assert a URL contract: response time, status code, no-redirect, and explicit test-id hooks.
 */
export async function checkUrlContract(page: Page, contract: URLContract): Promise<void> {
  const start = Date.now();
  const response = await page.goto(contract.url, { waitUntil: 'domcontentloaded' });
  const elapsed = Date.now() - start;

  if (contract.max_ttfb_ms !== undefined) {
    if (elapsed > contract.max_ttfb_ms) {
      throw new Error(
        `URL contract violation: ${contract.url} loaded in ${elapsed}ms, expected <${contract.max_ttfb_ms}ms`
      );
    }
  }

  if (contract.expected_status !== undefined && response) {
    const status = response.status();
    if (status !== contract.expected_status) {
      throw new Error(
        `URL contract violation: ${contract.url} returned HTTP ${status}, expected ${contract.expected_status}`
      );
    }
  }

  if (contract.must_not_redirect && response) {
    const finalUrl = page.url();
    const expected = new URL(contract.url, page.url()).href;
    if (!finalUrl.startsWith(expected.replace(/\/$/, ''))) {
      throw new Error(
        `URL contract violation: ${contract.url} redirected to ${finalUrl}`
      );
    }
  }

  if (contract.required_test_ids) {
    for (const testId of contract.required_test_ids) {
      const loc = page.locator(`[data-test-id="${testId}"], [data-testid="${testId}"]`).first();
      await pwExpect(loc, `data-test-id="${testId}" must exist — this is an explicit behavioral contract hook`).toBeAttached({ timeout: 5000 });
    }
  }
}

/**
 * Assert a multi-step user journey completes without error.
 * Each step is named so failures are clearly attributed.
 */
export async function checkJourneyCompletes(
  page: Page,
  name: string,
  steps: JourneyStep[]
): Promise<void> {
  for (const step of steps) {
    try {
      await step.action(page);
    } catch (err) {
      throw new Error(
        `Journey "${name}" failed at step: "${step.description}"\n` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

/**
 * Assert the page passes axe-core accessibility audit at the specified standard.
 * Filters to critical + serious violations only — the ones users actually hit.
 */
export async function checkA11y(
  page: Page,
  pageKey: string,
  standard: 'WCAG22AA' = 'WCAG22AA'
): Promise<void> {
  const tags = standard === 'WCAG22AA'
    ? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
    : ['wcag2a', 'wcag2aa'];

  const results = await new AxeBuilder({ page })
    .withTags(tags)
    .analyze();

  const violations = results.violations.filter(
    v => v.impact === 'critical' || v.impact === 'serious'
  );

  if (violations.length > 0) {
    const summary = violations
      .map(v => `[${v.impact}] ${v.id}: ${v.description}\n  Nodes: ${v.nodes.slice(0, 2).map(n => n.target.join(' > ')).join(', ')}`)
      .join('\n\n');
    throw new Error(`A11y violations on "${pageKey}" (${standard}):\n\n${summary}`);
  }
}

/**
 * Assert a state invariant holds — a boolean condition on extracted page state.
 * Useful for asserting things like "score is always non-negative" or "dealer always has cards".
 */
export async function checkStateInvariant<T>(
  name: string,
  extractor: () => Promise<T>,
  invariant: (state: T) => boolean
): Promise<void> {
  const state = await extractor();
  if (!invariant(state)) {
    throw new Error(
      `State invariant violated: "${name}"\nState was: ${JSON.stringify(state)}`
    );
  }
}

/**
 * BehaviorSuite class — groups helpers with metadata for structured logging.
 * Use this in test files for domain context.
 */
export class BehaviorSuite {
  constructor(public readonly meta: { feature: string; site: string; scope?: string }) {}

  async userCan(goal: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      throw new Error(
        `Expected user to be able to: "${goal}"\n` +
        `Cause: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async userCannot(goal: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch {
      return; // expected failure — user cannot do the thing
    }
    throw new Error(`Expected user to NOT be able to: "${goal}" — but it succeeded`);
  }

  pageLayoutMatches(page: Page, contract: LayoutContract): Promise<void> {
    return checkLayoutContract(page, contract);
  }

  urlContractHolds(page: Page, contract: URLContract): Promise<void> {
    return checkUrlContract(page, contract);
  }

  journeyCompletes(page: Page, name: string, steps: JourneyStep[]): Promise<void> {
    return checkJourneyCompletes(page, name, steps);
  }

  a11yClean(page: Page, pageKey: string, standard: 'WCAG22AA' = 'WCAG22AA'): Promise<void> {
    return checkA11y(page, pageKey, standard);
  }
}

export { findRegion };
