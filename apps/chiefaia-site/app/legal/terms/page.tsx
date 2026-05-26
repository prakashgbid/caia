/**
 * /legal/terms — Terms of Service.
 *
 * Same shape as the privacy page; see comment block there for the MDX
 * import + LegalPageShell rationale.
 */

import type { Metadata } from 'next';
import Terms, { frontmatter } from '../../../content/legal/terms.mdx';
import { LegalPageShell } from '../../../components/legal-page-shell';

export const metadata: Metadata = {
  title: frontmatter.title,
  description: frontmatter.summary,
  alternates: { canonical: '/legal/terms' },
  robots: { index: true, follow: true },
};

export const dynamic = 'force-static';

export default function TermsOfServicePage() {
  return (
    <LegalPageShell frontmatter={frontmatter}>
      <Terms />
    </LegalPageShell>
  );
}
