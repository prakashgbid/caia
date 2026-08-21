/**
 * DashboardGate — client-side mock-auth gate for /dashboard surfaces.
 *
 * Signed out (mock) -> replace to /sign-in?returnTo=<current path>.
 * Signed in (mock)  -> render children (+ the dev-only MockAuthToggle).
 *
 * This is UI-only gating per STOL-5003 — the real dashboard stays behind
 * Cloudflare Access on the dashboard origin.
 */

'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useMockAuth } from '../lib/mock-auth';
import { MockAuthToggle } from './mock-auth-toggle';

export function DashboardGate({ children }: { children: React.ReactNode }) {
  const { loggedIn, ready } = useMockAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (ready && !loggedIn) {
      router.replace(`/sign-in?returnTo=${encodeURIComponent(pathname)}`);
    }
  }, [ready, loggedIn, router, pathname]);

  if (!ready || !loggedIn) {
    return (
      <p className="py-24 text-center text-sm text-muted-foreground">
        Checking your session…
      </p>
    );
  }

  return (
    <>
      <MockAuthToggle />
      {children}
    </>
  );
}
