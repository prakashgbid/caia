import { chromium } from '@playwright/test';
import type { DeadShellReport, RegionResult, ClickResult } from './types';

export interface DetectorOptions {
  acceptanceCriteria?: string[];
  timeout?: number;
  viewport?: { width: number; height: number };
}

export async function detectDeadShell(url: string, options: DetectorOptions = {}): Promise<DeadShellReport> {
  const { timeout = 15000, viewport = { width: 1280, height: 800 } } = options;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewportSize(viewport);

  const report: DeadShellReport = {
    url,
    pageLoaded: false,
    pageTextLength: 0,
    regions: [],
    clicks: [],
    navLinks: [],
    overallPassed: false,
    summary: '',
  };

  try {
    const response = await page.goto(url, { waitUntil: 'networkidle', timeout });
    report.pageLoaded = !!(response && response.status() < 400);

    if (!report.pageLoaded) {
      report.summary = `❌ Page failed to load: ${response?.status() ?? 'no response'}`;
      return report;
    }

    // Measure page text
    const bodyText = await page.evaluate(() => document.body.innerText ?? '');
    report.pageTextLength = bodyText.length;

    // Check data-test-region attributes
    const regions = await page.evaluate(() => {
      const elements = document.querySelectorAll('[data-test-region]');
      return Array.from(elements).map(el => ({
        name: el.getAttribute('data-test-region') ?? '',
        selector: `[data-test-region="${el.getAttribute('data-test-region')}"]`,
        textLength: (el.textContent ?? '').trim().length,
        childCount: el.children.length,
        hasEmptyState: !!(el.querySelector('[data-empty-state], .empty-state, [aria-label*="empty"]')),
      }));
    });

    for (const r of regions) {
      const passed = r.textLength > 0 || r.hasEmptyState;
      report.regions.push({
        regionName: r.name,
        selector: r.selector,
        textLength: r.textLength,
        childCount: r.childCount,
        hasExplicitEmptyState: r.hasEmptyState,
        passed,
        message: passed
          ? `✅ Region "${r.name}" has content (${r.textLength} chars, ${r.childCount} children)`
          : `❌ Region "${r.name}" is empty with no empty-state message`,
      });
    }

    // Check nav links
    const navLinks = await page.evaluate(() => {
      const links = document.querySelectorAll('nav a[href], [role="navigation"] a[href]');
      return Array.from(links).map(a => (a as HTMLAnchorElement).href).filter(Boolean);
    });

    for (const href of [...new Set(navLinks)].slice(0, 20)) {
      try {
        const res = await fetch(href, { signal: AbortSignal.timeout(5000) });
        const body = await res.text();
        report.navLinks.push({ href, status: res.status, bodyLength: body.length, ok: res.status < 400 && body.length > 500 });
      } catch {
        report.navLinks.push({ href, status: 0, bodyLength: 0, ok: false });
      }
    }

    // Click interactive elements (sample up to 5)
    const clickables = await page.evaluate(() => {
      const els = document.querySelectorAll('button:not([disabled]), [role="button"]:not([disabled])');
      return Array.from(els).slice(0, 5).map((el, i) => ({
        index: i,
        text: (el.textContent ?? '').trim().slice(0, 50),
        selector: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''),
      }));
    });

    for (const el of clickables) {
      try {
        const urlBefore = page.url();
        const domBefore = await page.evaluate(() => document.body.innerHTML.length);
        await page.click(`${el.selector}`, { timeout: 3000 });
        await page.waitForTimeout(500);
        const urlAfter = page.url();
        const domAfter = await page.evaluate(() => document.body.innerHTML.length);
        const changed = urlAfter !== urlBefore || Math.abs(domAfter - domBefore) > 100;
        report.clicks.push({
          element: el.text || el.selector,
          triggered: true,
          resultUrl: urlAfter !== urlBefore ? urlAfter : undefined,
          domChanged: changed,
          message: changed ? `✅ Clicking "${el.text}" caused change` : `⚠️ Clicking "${el.text}" had no visible effect`,
        });
        // Navigate back if we left the page
        if (urlAfter !== urlBefore) await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
      } catch {
        report.clicks.push({
          element: el.text || el.selector,
          triggered: false,
          domChanged: false,
          message: `⚠️ Could not interact with "${el.text}"`,
        });
      }
    }

    // Determine overall pass
    const regionsFailed = report.regions.filter(r => !r.passed).length;
    const navFailed = report.navLinks.filter(n => !n.ok).length;
    report.overallPassed = report.pageLoaded && regionsFailed === 0 && navFailed === 0 && report.pageTextLength > 500;

    const issues: string[] = [];
    if (report.pageTextLength < 500) issues.push(`thin page (${report.pageTextLength} chars)`);
    if (regionsFailed > 0) issues.push(`${regionsFailed} empty regions`);
    if (navFailed > 0) issues.push(`${navFailed} broken nav links`);

    report.summary = report.overallPassed
      ? `✅ Page looks healthy (${report.pageTextLength} chars, ${report.regions.length} regions OK)`
      : `❌ Dead-shell issues: ${issues.join(', ')}`;

  } finally {
    await browser.close();
  }

  return report;
}
