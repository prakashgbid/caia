/**
 * Mock auth — UI-only stand-in for the real Cloudflare Access session.
 *
 * Per STOL-5003 the onboarding flow ships as a mock: a single localStorage
 * flag decides "signed in" vs "signed out". No backend, no cookies, no
 * persistence beyond the browser. The real dashboard auth continues to live
 * behind Cloudflare Access on the dashboard origin and is untouched here.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

export const MOCK_AUTH_KEY = 'mockAuth';

/** Custom event so same-tab listeners update immediately (the native
 *  `storage` event only fires in OTHER tabs). */
export const MOCK_AUTH_EVENT = 'chiefaia:mock-auth-changed';

export function isMockLoggedIn(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MOCK_AUTH_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setMockAuth(loggedIn: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (loggedIn) {
      window.localStorage.setItem(MOCK_AUTH_KEY, 'true');
    } else {
      window.localStorage.removeItem(MOCK_AUTH_KEY);
    }
    window.dispatchEvent(new Event(MOCK_AUTH_EVENT));
  } catch {
    // localStorage unavailable (private mode / SSR) — mock auth degrades to
    // permanently signed-out, which routes users to the real sign-in.
  }
}

/**
 * `ready` is false until the first client-side read so SSR markup and the
 * first client render agree (avoids hydration mismatch).
 */
export function useMockAuth(): {
  loggedIn: boolean;
  ready: boolean;
  setLoggedIn: (value: boolean) => void;
} {
  const [loggedIn, setLoggedInState] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sync = () => setLoggedInState(isMockLoggedIn());
    sync();
    setReady(true);
    window.addEventListener(MOCK_AUTH_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(MOCK_AUTH_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setLoggedIn = useCallback((value: boolean) => {
    setMockAuth(value);
    setLoggedInState(value);
  }, []);

  return { loggedIn, ready, setLoggedIn };
}
