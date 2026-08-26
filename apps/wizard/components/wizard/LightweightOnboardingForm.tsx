'use client';

/**
 * <LightweightOnboardingForm> — Stage 1 pre-payment onboarding.
 * Tailwind-styled per the CAIA brand system (indigo/violet primary, dark mode default).
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Eye, EyeOff, Sparkles } from 'lucide-react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from '@caia/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OPENROUTER_KEY_RE = /^sk-or-v1-[a-zA-Z0-9]{20,}$/;

export function LightweightOnboardingForm(): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [byokKey, setByokKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameValid = name.trim().length >= 2 && name.trim().length <= 80;
  const emailValid = EMAIL_RE.test(email.trim());
  const keyValid = byokKey.trim() === '' || OPENROUTER_KEY_RE.test(byokKey.trim());
  const canSubmit = nameValid && emailValid && keyValid && !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/wizard/onboarding/lightweight', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name.trim(), email: email.trim(), byokKey: byokKey.trim() || null }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      // Auto-advance to /wizard/grand-idea per continuity design
      router.push('/wizard/grand-idea');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [canSubmit, name, email, byokKey, router]);

  return (
    <Card className="border-border/60 bg-card/50 backdrop-blur-sm shadow-2xl shadow-primary/5">
      <CardHeader className="space-y-3">
        <div className="inline-flex items-center gap-2 w-fit px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
          <Sparkles className="w-3 h-3" />
          Welcome to CAIA
        </div>
        <CardTitle className="text-2xl sm:text-3xl font-bold tracking-tight">
          Let&apos;s <span className="text-brand-gradient">build something</span> together.
        </CardTitle>
        <CardDescription className="text-base leading-relaxed">
          Three quick fields. No credit card, no infrastructure spun up yet — CAIA only provisions real
          cloud/database/network once you approve an MVP plan. Everything up to that point lives in
          CAIA&apos;s own workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          <div>
            <label htmlFor="ob-name" className="block text-sm font-medium mb-2">Your name</label>
            <Input
              id="ob-name"
              data-testid="ob-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Founder"
              maxLength={80}
              className="h-11"
            />
            {!nameValid && name.length > 0 && (
              <p className="mt-1.5 text-xs text-destructive">2–80 characters, please.</p>
            )}
          </div>

          <div>
            <label htmlFor="ob-email" className="block text-sm font-medium mb-2">Email</label>
            <Input
              id="ob-email"
              data-testid="ob-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              maxLength={200}
              className="h-11"
            />
            {!emailValid && email.length > 0 && (
              <p className="mt-1.5 text-xs text-destructive">That doesn&apos;t look like a valid email.</p>
            )}
          </div>

          <div>
            <label htmlFor="ob-byok" className="block text-sm font-medium mb-2">
              OpenRouter API key <span className="font-normal text-muted-foreground">(optional — bring your own)</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  id="ob-byok"
                  data-testid="ob-byok"
                  type={showKey ? 'text' : 'password'}
                  value={byokKey}
                  onChange={(e) => setByokKey(e.target.value)}
                  placeholder="sk-or-v1-…"
                  className="h-11 pr-10 font-mono text-xs"
                  maxLength={200}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((s) => !s)}
                  data-testid="ob-byok-toggle"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {!keyValid && byokKey.length > 0 && (
              <p className="mt-1.5 text-xs text-destructive">
                OpenRouter keys start with <code className="bg-muted px-1 py-0.5 rounded text-[10px]">sk-or-v1-</code>.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
              Paste your own key and CAIA runs on your quota at ~$0 marginal cost — you only pay a small subscription later.
              Skip and CAIA covers it; you&apos;ll pay per-token at cost + a small markup once you cross the paywall.
              Your key stays encrypted and is only sent to OpenRouter — never logged, never shared.
            </p>
          </div>

          {error && (
            <div data-testid="ob-error" className="rounded-lg bg-destructive/10 border border-destructive/30 text-destructive px-3 py-2.5 text-sm">
              {error}
            </div>
          )}

          <div className="pt-2 flex items-center gap-3">
            <Button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              data-testid="ob-submit"
              className="h-11 px-6 bg-brand-gradient hover:opacity-90 text-white glow-brand text-sm font-semibold"
            >
              {busy ? 'Setting up…' : (
                <>
                  Continue to your idea
                  <ArrowRight className="w-4 h-4 ml-1.5" />
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">Next up: tell CAIA the one-paragraph vision.</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
