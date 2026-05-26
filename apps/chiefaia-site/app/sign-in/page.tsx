/**
 * /sign-in — redirects to dashboard.chiefaia.com, which sits behind
 * Cloudflare Access. The Access policy handles auth; this route exists so
 * the marketing nav has a canonical sign-in target on the chiefaia.com origin.
 *
 * Uses server-side redirect so there's no client-side flash. The redirect
 * target lives in `lib/site-config` so it's overridable via NEXT_PUBLIC env
 * for preview deployments.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { dashboardUrl } from '../../lib/site-config';

export const metadata: Metadata = {
  title: 'Sign in',
  description:
    'Sign in to ChiefAIA. Authentication is handled by Cloudflare Access on the dashboard origin.',
  alternates: { canonical: '/sign-in' },
  robots: { index: false, follow: true },
};

export const dynamic = 'force-static';

export default function SignInPage() {
  redirect(dashboardUrl);
}
