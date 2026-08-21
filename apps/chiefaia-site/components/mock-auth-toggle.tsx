/**
 * MockAuthToggle — dev-only switch for the STOL-5003 mock auth flag.
 *
 * Hidden in production builds (`process.env.NODE_ENV === 'production'`);
 * on chiefaia.com the operator flips the flag from devtools instead:
 *   localStorage.setItem('mockAuth', 'true')
 */

'use client';

import { Button } from '@caia/ui';
import { useMockAuth } from '../lib/mock-auth';

export function MockAuthToggle() {
  const { loggedIn, ready, setLoggedIn } = useMockAuth();

  if (process.env.NODE_ENV === 'production') return null;
  if (!ready) return null;

  return (
    <div className="fixed right-4 top-20 z-50">
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid="mock-auth-toggle"
        onClick={() => setLoggedIn(!loggedIn)}
      >
        {loggedIn ? 'Mock: signed in' : 'Mock: signed out'}
      </Button>
    </div>
  );
}
