'use client';

/**
 * <LoginPill> — header slot. Shows "Login" if logged out; user avatar + name
 * if logged in. Per operator direction "on the header the button 'dashboard'
 * should be replaced with login."
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogIn, User } from 'lucide-react';
import { readSession, type Session } from '../../lib/session/tokens';

export function LoginPill(): React.JSX.Element {
  const [s, setS] = useState<Session>({ tokens: 50, loggedIn: false, history: [] });
  useEffect(() => {
    setS(readSession());
    const on = () => setS(readSession());
    window.addEventListener('caia:session-change', on);
    return () => window.removeEventListener('caia:session-change', on);
  }, []);

  if (s.loggedIn) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 text-xs h-8 px-2 rounded-md bg-primary/10 text-foreground">
        <User className="w-3.5 h-3.5 text-primary" />
        <span className="max-w-[120px] truncate">{s.displayName || s.email || 'You'}</span>
      </div>
    );
  }

  return (
    <Link
      href="/wizard/login?next=/wizard/onboarding"
      className="inline-flex items-center gap-1.5 text-xs font-medium h-8 px-3 rounded-md bg-brand-gradient text-white hover:opacity-90 transition-opacity"
      title="Log in to save your work"
    >
      <LogIn className="w-3.5 h-3.5" />
      Login
    </Link>
  );
}
