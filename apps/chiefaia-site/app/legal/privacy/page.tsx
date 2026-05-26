/**
 * /legal/privacy — Privacy Policy.
 *
 * Renders `content/legal/privacy.mdx` inside the shared LegalPageShell, which
 * surfaces the operator-required "pending counsel review" banner at the top
 * AND the bottom of the document plus the lastUpdated stamp from the MDX
 * frontmatter.
 *
 * MDX import shape: `Privacy` is the compiled component (default export);
 * `frontmatter` is exposed by remark-mdx-frontmatter (see next.config.mjs).
 */

import type { Metadata } from 'next';
import Privacy, { frontmatter } from '../../../content/legal/privacy.mdx';
import { LegalPageShell } from '../../../components/legal-page-shell';

export const metadata: Metadata = {
  title: frontmatter.title,
  description: frontmatter.summary,
  alternates: { canonical: '/legal/privacy' },
  robots: { index: true, follow: true },
};

export const dynamic = 'force-static';

export default function PrivacyPolicyPage() {
  return (
    <LegalPageShell frontmatter={frontmatter}>
      <Privacy />
    </LegalPageShell>
  );
}
