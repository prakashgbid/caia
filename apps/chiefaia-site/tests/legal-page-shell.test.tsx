/**
 * LegalPageShell — counsel-review banner + lastUpdated rendering tests.
 *
 * Why not import the actual page.tsx + MDX content here? Vitest doesn't run
 * the @next/mdx webpack loader; importing `*.mdx` from a vitest test would
 * fail. We exercise the shell directly with hard-coded frontmatter values,
 * which is sufficient to verify:
 *   1. Top banner is rendered when counselReviewPending is true
 *   2. Bottom banner is ALSO rendered (operator-required: banner appears
 *      both top and bottom so it's impossible to read the doc without
 *      seeing it)
 *   3. lastUpdated date appears as a `<time>` element in the human-readable
 *      formatted form
 *   4. When counselReviewPending is false, neither banner renders
 *
 * MDX-content correctness (the policies themselves) is reviewed by counsel
 * and verified by `next build`; it's not a runtime-testable property.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LegalPageShell } from '../components/legal-page-shell';
import type { LegalDocFrontmatter } from '../types/legal-doc';

const SAMPLE_FRONTMATTER: LegalDocFrontmatter = {
  title: 'Sample Policy',
  slug: 'sample',
  lastUpdated: '2026-05-25',
  effectiveDate: '2026-05-25',
  summary: 'A test summary that should render under the title.',
  counselReviewPending: true,
};

describe('LegalPageShell', () => {
  it('renders the document title from frontmatter', () => {
    render(
      <LegalPageShell frontmatter={SAMPLE_FRONTMATTER}>
        <p>body</p>
      </LegalPageShell>
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Sample Policy' })
    ).toBeInTheDocument();
  });

  it('renders the counsel-review banner BOTH at the top and at the bottom', () => {
    render(
      <LegalPageShell frontmatter={SAMPLE_FRONTMATTER}>
        <p>body</p>
      </LegalPageShell>
    );
    expect(
      screen.getByTestId('legal-counsel-review-banner-top')
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('legal-counsel-review-banner-bottom')
    ).toBeInTheDocument();
  });

  it('shows the lastUpdated date in human-readable form as a <time>', () => {
    render(
      <LegalPageShell frontmatter={SAMPLE_FRONTMATTER}>
        <p>body</p>
      </LegalPageShell>
    );
    const stamp = screen.getByTestId('legal-last-updated');
    expect(stamp).toBeInTheDocument();
    expect(stamp.textContent).toMatch(/Last updated May 25, 2026/);
    const timeEl = stamp.querySelector('time');
    expect(timeEl?.getAttribute('dateTime')).toBe('2026-05-25');
  });

  it('renders the summary when one is provided', () => {
    render(
      <LegalPageShell frontmatter={SAMPLE_FRONTMATTER}>
        <p>body</p>
      </LegalPageShell>
    );
    expect(
      screen.getByText('A test summary that should render under the title.')
    ).toBeInTheDocument();
  });

  it('hides both banners when counselReviewPending is false', () => {
    render(
      <LegalPageShell
        frontmatter={{ ...SAMPLE_FRONTMATTER, counselReviewPending: false }}
      >
        <p>body</p>
      </LegalPageShell>
    );
    expect(
      screen.queryByTestId('legal-counsel-review-banner-top')
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('legal-counsel-review-banner-bottom')
    ).not.toBeInTheDocument();
  });

  it('renders the children body content', () => {
    render(
      <LegalPageShell frontmatter={SAMPLE_FRONTMATTER}>
        <p data-testid="body">document body</p>
      </LegalPageShell>
    );
    expect(screen.getByTestId('body')).toBeInTheDocument();
  });
});
