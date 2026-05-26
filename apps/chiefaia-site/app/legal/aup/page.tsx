/**
 * /legal/aup — Acceptable Use Policy.
 *
 * Same shape as the privacy / terms pages; see comment block on privacy.
 */

import type { Metadata } from 'next';
import Aup, { frontmatter } from '../../../content/legal/aup.mdx';
import { LegalPageShell } from '../../../components/legal-page-shell';

export const metadata: Metadata = {
  title: frontmatter.title,
  description: frontmatter.summary,
  alternates: { canonical: '/legal/aup' },
  robots: { index: true, follow: true },
};

export const dynamic = 'force-static';

export default function AcceptableUsePolicyPage() {
  return (
    <LegalPageShell frontmatter={frontmatter}>
      <Aup />
    </LegalPageShell>
  );
}
