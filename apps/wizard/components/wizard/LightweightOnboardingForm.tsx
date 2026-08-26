'use client';

/**
 * <LightweightOnboardingForm> — the pre-payment Stage 1 form.
 *
 * Three fields, one submit, redirect to /wizard/grand-idea. That's it.
 *
 * BYOK explanation copy comes inline. Founders can either paste their
 * OpenRouter key (and get everything at ~$0 marginal cost per
 * [[byok-first-ai]]) or skip and use CAIA's own key (billed as tokens
 * at cost+markup — pricing TBD).
 *
 * Reuse-first: @caia/ui primitives (Card, Button, Input) plus native
 * elements for label/small.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
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
        body: JSON.stringify({
          displayName: name.trim(),
          email: email.trim(),
          byokKey: byokKey.trim() || null,
        }),
      });
      // In demo-mode shim OR real handler, we redirect on success.
      // Non-2xx = surface message and stay.
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        throw new Error(body.error || body.message || `HTTP ${res.status}`);
      }
      router.push('/wizard/grand-idea');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, [canSubmit, name, email, byokKey, router]);

  return (
    <Card data-testid="wizard-step-onboarding-lightweight">
      <CardHeader>
        <CardTitle>Welcome — tell us who you are</CardTitle>
        <CardDescription>
          Three quick fields. No credit card, no infrastructure spun up yet — CAIA
          only provisions real cloud/DB/network once you approve an MVP scope and
          plan. Everything up to that point lives in CAIA&apos;s own workspace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label htmlFor="ob-name" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Your name
            </label>
            <Input
              id="ob-name"
              data-testid="ob-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alex Founder"
              maxLength={80}
            />
            {!nameValid && name.length > 0 && (
              <small style={{ color: '#fca5a5', fontSize: 12 }}>2-80 characters, please.</small>
            )}
          </div>

          <div>
            <label htmlFor="ob-email" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Email
            </label>
            <Input
              id="ob-email"
              data-testid="ob-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              maxLength={200}
            />
            {!emailValid && email.length > 0 && (
              <small style={{ color: '#fca5a5', fontSize: 12 }}>That doesn&apos;t look like a valid email.</small>
            )}
          </div>

          <div>
            <label htmlFor="ob-byok" style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              OpenRouter API key <span style={{ fontWeight: 400, opacity: 0.7 }}>(optional — bring your own)</span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                id="ob-byok"
                data-testid="ob-byok"
                type={showKey ? 'text' : 'password'}
                value={byokKey}
                onChange={(e) => setByokKey(e.target.value)}
                placeholder="sk-or-v1-..."
                style={{ flex: 1 }}
                maxLength={200}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowKey((s) => !s)}
                data-testid="ob-byok-toggle"
              >
                {showKey ? 'Hide' : 'Show'}
              </Button>
            </div>
            {!keyValid && byokKey.length > 0 && (
              <small style={{ color: '#fca5a5', fontSize: 12 }}>
                OpenRouter keys start with <code>sk-or-v1-</code>.
              </small>
            )}
            <small style={{ display: 'block', marginTop: 6, color: '#94a3b8', fontSize: 12, lineHeight: 1.4 }}>
              Paste your own OpenRouter key and CAIA runs on your quota at $0 marginal cost — you only
              pay a small subscription later. Skip this and CAIA uses its own key; you&apos;ll be billed
              per-token at cost + a small markup once you cross the paywall (both prices TBD).
              Your key stays encrypted at rest and is only sent to OpenRouter — never logged, never
              shared with other tenants.
            </small>
          </div>

          {error && (
            <div
              data-testid="ob-error"
              style={{ padding: 12, background: '#7f1d1d', color: '#fee2e2', borderRadius: 6, fontSize: 13 }}
            >
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <Button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              data-testid="ob-submit"
            >
              {busy ? 'Setting up…' : 'Continue to your idea →'}
            </Button>
            <small style={{ color: '#94a3b8', fontSize: 12 }}>
              Takes ~1 second. Next step: tell CAIA the one-paragraph vision of what you want to build.
            </small>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
