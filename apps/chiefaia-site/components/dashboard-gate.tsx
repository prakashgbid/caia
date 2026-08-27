/**
 * DashboardGate — public demo pass-through (STOL-5003 revisited 2026-08-25 CAIA-403).
 *
 * Previously blocked anonymous visitors with a "Checking your session…"
 * spinner and a cross-origin redirect to dashboard.chiefaia.com/sign-in
 * (Cloudflare Access). That closed the demo path to any founder who is not
 * on the CF Access team — the exact opposite of the ship-don't-plan goal.
 *
 * Now: /dashboard is a public mock so a visitor can SEE the workspace
 * shape immediately. Sign-in is only required when a mutating action is
 * taken (create/save project) — enforced at those buttons via
 * AuthGatedLink or the real backend behind dashboard.chiefaia.com.
 */

'use client';

import { MockAuthToggle } from './mock-auth-toggle';

export function DashboardGate({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MockAuthToggle />
      {children}
    </>
  );
}
