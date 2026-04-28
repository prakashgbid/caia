/**
 * Runtime Playwright layer.
 * Visits each route, finds all interactive elements, clicks them,
 * and flags any that produce no observable effect.
 *
 * Requires @playwright/test to be installed (peer dep) and a running server.
 */

import type { Issue } from '../types';

export interface ClickthroughOptions {
  baseUrl: string;
  routes: string[];
  /** ms to wait after each click for observable change */
  waitMs?: number;
  /** Whether to include screenshots in report */
  screenshots?: boolean;
}

export interface ClickthroughResult {
  routesTested: number;
  elementsClicked: number;
  issues: Issue[];
}

async function hashDOM(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(`document.body.innerHTML.length + '|' + document.title`) as Promise<string>;
}

/**
 * Run Playwright clickthrough test against a live server.
 * Returns all "dead action" issues found.
 */
export async function runClickthrough(opts: ClickthroughOptions): Promise<ClickthroughResult> {
  // Dynamically require playwright to avoid hard dep
  let chromium: import('@playwright/test').BrowserType;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch {
    throw new Error(
      'Runtime layer requires @playwright/test. Install it: npm install --save-dev @playwright/test',
    );
  }

  const { baseUrl, routes, waitMs = 500 } = opts;
  const issues: Issue[] = [];
  let elementsClicked = 0;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    for (const route of routes) {
      const url = `${baseUrl}${route}`;
      const page = await context.newPage();

      // Suppress console errors from page under test
      page.on('console', () => {});
      page.on('pageerror', () => {});

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      } catch {
        issues.push({
          rule: 'http-error',
          severity: 'error',
          file: `${route}/page.tsx`,
          line: 0,
          col: 0,
          message: `Page failed to load: ${url}`,
          fix: 'Check the route renders without errors',
        });
        await page.close();
        continue;
      }

      const selector = 'button:not([disabled]), [role="button"]:not([disabled]), input[type="button"]:not([disabled]), input[type="submit"]:not([disabled])';
      const elements = await page.locator(selector).all();

      for (const el of elements) {
        try {
          const domBefore = await hashDOM(page);
          const networkBefore = await page.evaluate(`performance.getEntriesByType('resource').length`) as number;
          const urlBefore = page.url();

          await el.click({ timeout: 3_000 });
          await page.waitForTimeout(waitMs);

          const domAfter = await hashDOM(page);
          const networkAfter = await page.evaluate(`performance.getEntriesByType('resource').length`) as number;
          const urlAfter = page.url();

          elementsClicked++;

          const hasChange =
            domAfter !== domBefore ||
            networkAfter > networkBefore ||
            urlAfter !== urlBefore;

          if (!hasChange) {
            const label = await el.textContent().catch(() => '<unknown>');
            const ariaLabel = await el.getAttribute('aria-label').catch(() => null);
            const desc = ariaLabel ?? (label?.trim() ?? '<unknown>');
            issues.push({
              rule: 'dead-onclick',
              severity: 'warning',
              file: `${route}/page.tsx`,
              line: 0,
              col: 0,
              message: `Runtime: clicking "${desc}" produced no observable change (DOM, URL, or network)`,
              fix: 'Add a real click handler or remove the interactive element',
            });
          }

          // Navigate back if we left the page
          if (urlAfter !== urlBefore) {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => {});
          }
        } catch {
          // Element might have navigated away, been removed, etc. — skip
        }
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }

  return { routesTested: routes.length, elementsClicked, issues };
}
