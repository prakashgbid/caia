/**
 * LegalPageShell — common chrome around a legal MDX document.
 *
 * Renders:
 *   - a prominent "draft — pending counsel review" banner at the TOP of the
 *     page (operator-required, see PR description for
 *     [chiefaia-site-legal-pages-on-602])
 *   - the document title + summary read from the MDX frontmatter
 *   - a `lastUpdated` strip just below the title
 *   - the MDX body (passed as children)
 *   - a footer-level repeat of the counsel-review notice so it's impossible
 *     to read the page without seeing the disclaimer
 *
 * Composed from `@caia/ui` Card primitives per the reuse-first doctrine
 * (ADR-065). All page-local styling uses Tailwind utility classes that
 * resolve through `@caia/ui`'s design-token CSS variables — no raw hex.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@caia/ui';
import type { LegalDocFrontmatter } from '../types/legal-doc';

interface LegalPageShellProps {
  frontmatter: LegalDocFrontmatter;
  children: React.ReactNode;
}

/**
 * Format an ISO date (YYYY-MM-DD) as a human-readable string. UTC-anchored
 * so the rendered form is stable across server / client.
 */
function formatLastUpdated(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

export function LegalPageShell({ frontmatter, children }: LegalPageShellProps) {
  const lastUpdatedHuman = formatLastUpdated(frontmatter.lastUpdated);
  return (
    <article className="mx-auto max-w-3xl space-y-10">
      {frontmatter.counselReviewPending ? (
        <CounselReviewBanner placement="top" lastUpdatedHuman={lastUpdatedHuman} />
      ) : null}

      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Legal
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          {frontmatter.title}
        </h1>
        {frontmatter.summary ? (
          <p className="max-w-2xl text-muted-foreground">{frontmatter.summary}</p>
        ) : null}
        <p
          className="text-sm text-muted-foreground"
          data-testid="legal-last-updated"
        >
          Last updated{' '}
          <time dateTime={frontmatter.lastUpdated}>{lastUpdatedHuman}</time>
        </p>
      </header>

      <div className="legal-body">{children}</div>

      {frontmatter.counselReviewPending ? (
        <CounselReviewBanner placement="bottom" lastUpdatedHuman={lastUpdatedHuman} />
      ) : null}
    </article>
  );
}

interface CounselReviewBannerProps {
  placement: 'top' | 'bottom';
  lastUpdatedHuman: string;
}

function CounselReviewBanner({
  placement,
  lastUpdatedHuman,
}: CounselReviewBannerProps) {
  return (
    <Card
      role="note"
      aria-label="Draft pending counsel review"
      className="border-amber-500/40 bg-amber-50/40 dark:border-amber-400/30 dark:bg-amber-900/10"
      data-testid={`legal-counsel-review-banner-${placement}`}
    >
      <CardHeader className="space-y-2">
        <CardTitle className="text-base font-semibold text-foreground">
          Draft — pending counsel review
        </CardTitle>
        <CardDescription>
          This document is a working draft authored from public boilerplate
          templates and customised for ChiefAIA. It has not yet been reviewed
          by counsel. The operating-posture statements are accurate as of the
          last-updated date ({lastUpdatedHuman}); the legal phrasing will be
          tightened in a subsequent counsel-reviewed revision. Do not rely on
          this document as a substitute for legal advice.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Questions or corrections:{' '}
        <a
          href="mailto:legal@chiefaia.com"
          className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
        >
          legal@chiefaia.com
        </a>
        .
      </CardContent>
    </Card>
  );
}
