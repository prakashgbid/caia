'use client';

/**
 * <LoginPanel> — Stage 7 mock login gate.
 *
 * Presents Google / Apple / email-password options. Real OAuth is post-MVP
 * per operator direction; all three buttons call grantLoginReward() which
 * marks the session logged in and credits LOGIN_REWARD tokens.
 */

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, Chrome, Coins, Loader2, Mail, Sparkles } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@caia/ui';
import { grantLoginReward, readSession, LOGIN_REWARD } from '../../lib/session/tokens';
import { InputExplainer } from './common/InputExplainer';
import { validateEmail } from '../../lib/validate/text';

export function LoginPanel(): React.JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const nextPath = search?.get('next') || '/wizard/build';
  const [emailMode, setEmailMode] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = typeof window !== 'undefined' ? readSession() : { tokens: 0, loggedIn: false };

  const finalize = useCallback((displayName: string, emailAddr: string) => {
    setBusy(true);
    setTimeout(() => {
      grantLoginReward(displayName, emailAddr);
      router.push(nextPath);
    }, 700);
  }, [router, nextPath]);

  const google = useCallback(() => finalize('Alex Founder', 'alex@example.com'), [finalize]);
  const apple = useCallback(() => finalize('Alex Founder', 'alex@icloud.com'), [finalize]);
  const emailSubmit = useCallback(() => {
    if (name.trim().length < 2) { setError('Please enter your name (at least 2 characters).'); return; }
    const ev = validateEmail(email);
    if (!ev.ok) { setError(ev.reason || 'That doesn\'t look like a valid email.'); return; }
    setError(null);
    finalize(name.trim(), email.trim());
  }, [finalize, name, email]);

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5 max-w-lg mx-auto">
      <CardHeader className="space-y-3 text-center">
        <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium mx-auto">
          <Sparkles className="w-3 h-3" />
          Step 7 · Log in
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
          You&apos;re out of <span className="text-brand-gradient">CAIA tokens</span>.
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          You used your {50 - Math.max(0, current.tokens)} starter tokens to design your idea and its landing page.
          Log in and we&apos;ll top you up with <strong className="text-foreground">{LOGIN_REWARD} more</strong> so you can build the click-through MVP.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {!emailMode ? (
            <>
              <Button
                type="button"
                onClick={google}
                disabled={busy}
                className="w-full h-12 bg-white hover:bg-white/90 text-black text-sm font-semibold"
              >
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Chrome className="w-4 h-4 mr-2" />}
                Continue with Google
              </Button>
              <Button
                type="button"
                onClick={apple}
                disabled={busy}
                className="w-full h-12 bg-black hover:bg-black/85 text-white text-sm font-semibold border border-white/10"
              >
                {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : (
                  <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>
                )}
                Continue with Apple
              </Button>
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div>
              </div>
              <Button
                type="button"
                onClick={() => setEmailMode(true)}
                variant="outline"
                className="w-full h-12 text-sm font-semibold"
              >
                <Mail className="w-4 h-4 mr-2" />
                Continue with email
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1.5">Your name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Founder" className="h-11" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1.5">Email</label>
                <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="alex@example.com" className="h-11" />
                <InputExplainer hint="Used to save your project. We never spam." />
              </div>
              {error && <div className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2 text-sm">{error}</div>}
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  onClick={emailSubmit}
                  disabled={busy}
                  className="flex-1 h-11 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
                >
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <ArrowRight className="w-4 h-4 mr-2" />}
                  Create account & continue
                </Button>
                <Button type="button" variant="ghost" onClick={() => setEmailMode(false)} className="h-11">
                  Back
                </Button>
              </div>
            </div>
          )}
          <p className="text-xs text-muted-foreground text-center pt-2 flex items-center justify-center gap-1">
            <Coins className="w-3 h-3" />
            {LOGIN_REWARD} tokens credited on sign-in.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
