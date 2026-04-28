import type { Page } from '@playwright/test';

/** Semantic page regions — checked via ARIA landmarks, semantic HTML, and stable data-test-id hooks. */
export type RegionKey =
  | 'header'
  | 'footer'
  | 'nav'
  | 'hero'
  | 'primary_cta'
  | 'game_root'
  | 'bet_controls'
  | 'status_region'
  | 'feature_list'
  | 'cta'
  | 'main_content'
  | 'article_body';

/**
 * Ordered list of locator strategies per region.
 * Stable across DOM refactors — the first matching selector wins.
 * Only `data-test-id` and semantic HTML/ARIA are allowed here.
 */
export const REGION_LOCATORS: Record<RegionKey, string[]> = {
  header:         ['header', '[role="banner"]'],
  footer:         ['footer', '[role="contentinfo"]'],
  nav:            ['nav', '[role="navigation"]'],
  hero:           ['[data-test-id="hero"]', '[data-testid="hero"]', 'section.hero', '#hero', 'h1'],
  primary_cta:    ['[data-test-id="primary-cta"]', '[data-testid="primary-cta"]', 'a[href="/play"]', 'a.primary-cta'],
  game_root:      ['[data-test-id="game-root"]', '[data-testid="game-root"]', '#game-root', '[role="application"]'],
  bet_controls:   ['[data-test-id="bet-controls"]', '[data-testid="bet-controls"]', '[aria-label*="bet" i]'],
  status_region:  ['[data-test-id="status-region"]', '[data-testid="status-region"]', '[aria-live]', '[role="status"]'],
  feature_list:   ['[data-test-id="feature-list"]', '[data-testid="feature-list"]', '[role="list"]', 'ul'],
  cta:            ['[data-test-id="cta"]', '[data-testid="cta"]', 'a[href][class*="cta"]'],
  main_content:   ['main', '[role="main"]', '#main-content'],
  article_body:   ['[data-test-id="article-body"]', 'article', '[role="article"]'],
};

/** Layout shape contract — asserts presence of semantic regions without specifying DOM internals. */
export interface LayoutContract {
  must_have: RegionKey[];
  footer_link_groups?: string;  // e.g. ">=3"
  brand_palette?: string[];     // locked CSS hex colors
  notes?: string;
}

/** URL behavioral contract — the one place stable DOM hooks are explicitly required. */
export interface URLContract {
  url: string;
  max_ttfb_ms?: number;
  must_not_redirect?: boolean;
  expected_status?: number;
  required_test_ids?: string[];  // data-test-id values that MUST exist as the explicit contract surface
}

export interface JourneyStep {
  description: string;
  action: (page: Page) => Promise<void>;
}

export type TestStatus = 'pass' | 'fail' | 'skip' | 'flaky';

export interface TestResult {
  feature: string;
  spec: string;
  status: TestStatus;
  duration: number;
  evidenceUrl?: string;
  failureExcerpt?: string;
  gitSha?: string;
  ci?: boolean;
}

export interface CoverageRollup {
  total: number;
  passing: number;
  failing: number;
  skipped: number;
  byFeature: Record<string, { total: number; passing: number; failing: number }>;
  byDomain: Record<string, { total: number; passing: number; failing: number }>;
  byProject: Record<string, { total: number; passing: number; failing: number }>;
}

export interface BehaviorSuiteMeta {
  feature: string;
  site: string;
  scope?: string;
  domainSlugs?: string[];
}
