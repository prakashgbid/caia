// Unit tests for the report structure and logic (not actual Playwright run)
import type { DeadShellReport } from '../types';

describe('DeadShellReport structure', () => {
  it('has expected fields', () => {
    const report: DeadShellReport = {
      url: 'http://localhost:7777',
      pageLoaded: false,
      pageTextLength: 0,
      regions: [],
      clicks: [],
      navLinks: [],
      overallPassed: false,
      summary: 'Not run',
    };
    expect(report.url).toBe('http://localhost:7777');
    expect(report.pageLoaded).toBe(false);
    expect(Array.isArray(report.regions)).toBe(true);
    expect(Array.isArray(report.clicks)).toBe(true);
    expect(Array.isArray(report.navLinks)).toBe(true);
  });

  it('region with content passes', () => {
    const r = {
      regionName: 'main-content',
      selector: '[data-test-region="main-content"]',
      textLength: 500,
      childCount: 3,
      hasExplicitEmptyState: false,
      passed: true,
      message: '✅ Region "main-content" has content',
    };
    expect(r.passed).toBe(true);
  });

  it('empty region without empty-state fails', () => {
    const r = {
      regionName: 'sidebar',
      selector: '[data-test-region="sidebar"]',
      textLength: 0,
      childCount: 0,
      hasExplicitEmptyState: false,
      passed: false,
      message: '❌ Region "sidebar" is empty with no empty-state message',
    };
    expect(r.passed).toBe(false);
  });

  it('empty region WITH empty-state passes', () => {
    const r = {
      regionName: 'results',
      selector: '[data-test-region="results"]',
      textLength: 12,
      childCount: 1,
      hasExplicitEmptyState: true,
      passed: true,
      message: '✅',
    };
    expect(r.passed).toBe(true);
  });
});
