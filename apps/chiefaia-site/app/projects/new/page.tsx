/**
 * /projects/new — legacy "New Project" route (pre-STOL-5003).
 *
 * The new-project flow now lives at /dashboard/new-project behind the
 * mock-auth check; this page forwards with the same check applied.
 */

import type { Metadata } from 'next';
import { LegacyProjectsRedirect } from '../../../components/legacy-projects-redirect';

export const metadata: Metadata = {
  title: 'New Project',
  description:
    'Start a new ChiefAIA project: hand the pipeline a product brief and the interviewer agent fills in the gaps.',
  alternates: { canonical: '/projects/new' },
  robots: { index: false, follow: true },
};

export default function NewProjectPage() {
  return <LegacyProjectsRedirect target="/dashboard/new-project" />;
}
