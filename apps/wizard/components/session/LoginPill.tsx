'use client';

/**
 * <LoginPill> — header slot. Logged out: purple Login button. Logged in:
 * user chip that expands into a small dropdown with tokens balance +
 * Sign out.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { LogIn, LogOut, User, Coins } from 'lucide-react';
import { readSession, type Session } from '../../lib/session/tokens';

export function LoginPill(): React.JSX.Element {
  const [s, setS] = useState<Session>({ tokens: 50, loggedIn: false, history: [] });
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setS(readSession());
    const on = () => setS(readSession());
    window.addEventListener('caia:session-change', on);
    return () => window.removeEventListener('caia:session-change', on);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (btnRef.current && !btnRef.current.contains(e.target as Node)) {
        const dd = document.getElementById('caia-login-dropdown');
        if (dd && !dd.contains(e.target as Node)) setOpen(false);
      }
    };
    window.addEventListener('click', onClick);
    return () => window.removeEventListener('click', onClick);
  }, [open]);

  async function signOut() {
    try { await fetch('/api/wizard/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
    try {
      window.localStorage.removeItem('caia_session');
      // Fire session-change so header updates
      window.dispatchEvent(new CustomEvent('caia:session-change'));
    } catch {}
    setOpen(false);
    window.location.href = '/';
  }

  if (!s.loggedIn) {
    return (
      <Link
        href="/wizard/login?next=/"
        className="inline-flex items-center gap-1.5 text-xs font-medium h-8 px-3 rounded-md bg-brand-gradient text-white hover:opacity-90 transition-opacity"
        title="Log in to save your work"
      >
        <LogIn className="w-3.5 h-3.5" />
        Login
      </Link>
    );
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="hidden sm:flex items-center gap-1.5 text-xs h-8 px-2 rounded-md bg-primary/10 hover:bg-primary/15 text-foreground transition-colors"
      >
        <User className="w-3.5 h-3.5 text-primary" />
        <span className="max-w-[120px] truncate">{s.displayName || s.email || 'You'}</span>
      </button>
      {open && (
        <div id="caia-login-dropdown" className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-border/60 bg-card shadow-2xl z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/50 space-y-0.5">
            <div className="text-sm font-semibold truncate">{s.displayName}</div>
            <div className="text-xs text-muted-foreground truncate">{s.email}</div>
            <div className="text-xs text-primary flex items-center gap-1 pt-1"><Coins className="w-3 h-3" /> {s.tokens} tokens</div>
          </div>
          <Link href="/" onClick={() => setOpen(false)} className="block px-4 py-2 text-sm hover:bg-muted/50 transition-colors">Your projects</Link>
          <button type="button" onClick={signOut} className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left text-destructive hover:bg-destructive/10 transition-colors">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
