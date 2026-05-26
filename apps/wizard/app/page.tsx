import { redirect } from 'next/navigation';

/**
 * Wizard app entry — sends authenticated customers into the first
 * wizard step. Cloudflare Access (in front of dashboard.chiefaia.com)
 * gates this so unauthenticated visitors never reach here; the
 * middleware then provisions the tenant and forwards.
 */
export default function Home() {
  redirect('/wizard/onboarding');
}
