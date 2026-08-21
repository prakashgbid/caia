/**
 * /projects — legacy "Your Projects" route (pre-STOL-5003).
 *
 * The projects surface now lives at /dashboard behind the mock-auth check,
 * so this page only runs the same client-side check and forwards:
 * signed in (mock) -> /dashboard, signed out -> /sign-in.
 */

import type { Metadata } from 'next';
import { LegacyProjectsRedirect } from '../../components/legacy-projects-redirect';

export const metadata: Metadata = {
  title: 'Your Projects',
  description:
    'View and manage your ChiefAIA projects. Sign in to see the briefs and pipeline runs you own.',
  alternates: { canonical: '/projects' },
  robots: { index: false, follow: true },
};

export default function ProjectsPage() {
  return <LegacyProjectsRedirect target="/dashboard" />;
}
