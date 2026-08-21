/**
 * LegacyProjectsRedirect — client redirect for the pre-STOL-5003 routes
 * (/projects, /projects/new). Runs the same mock-auth check as the CTAs:
 * signed in -> the new /dashboard surface, signed out -> /sign-in.
 */

'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { isMockLoggedIn } from '../lib/mock-auth';

export function LegacyProjectsRedirect({ target }: { target: string }) {
  const router = useRouter();

  useEffect(() => {
    if (isMockLoggedIn()) {
      router.replace(target);
    } else {
      router.replace(`/sign-in?returnTo=${encodeURIComponent(target)}`);
    }
  }, [router, target]);

  return (
    <p className="py-24 text-center text-sm text-muted-foreground">
      Redirecting…
    </p>
  );
}
