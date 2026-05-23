'use client';

/**
 * Wizard — one screen per category. Renders the provider dropdown,
 * the credential fields per descriptor, and an inline validator log.
 *
 * Server work flows through the JSON API routes under
 * `/api/onboarding/*` rather than server-actions so that the same
 * surface can be hit by the CLI mirror (`@caia/cli onboard`) and by
 * Playwright E2E.
 */

import { useEffect, useMemo, useState } from 'react';
import type { CategoryDefinition, ProviderOption } from '@caia/onboarding';

interface WizardStateStep {
  category: { id: string; label: string; ordinal: number; required: boolean };
  status: 'pending' | 'probing' | 'passed' | 'failed' | 'deferred';
  attemptCount: number;
  failureReason?: string;
}

interface WizardState {
  tenantId: string;
  currentId?: string;
  steps: WizardStateStep[];
  ready: boolean;
}

interface WizardProps {
  tenantId: string;
  category: CategoryDefinition;
  initialState: WizardState;
}

export function Wizard({ tenantId, category, initialState }: WizardProps) {
  const [state, setState] = useState<WizardState>(initialState);
  const [providerId, setProviderId] = useState<string>(category.providers[0]?.id ?? '');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    status: string;
    message?: string;
  } | null>(null);

  const provider: ProviderOption | undefined = useMemo(
    () => category.providers.find((p) => p.id === providerId),
    [category, providerId],
  );

  useEffect(() => {
    setCreds({});
    setChoices({});
    setResult(null);
  }, [providerId, category.id]);

  async function submit(): Promise<void> {
    setSubmitting(true);
    setResult({ status: 'probing' });
    try {
      const res = await fetch('/api/onboarding/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          category: category.id,
          providerId,
          choices,
          credentials: creds,
        }),
      });
      const body = await res.json();
      setResult({
        status: body.status,
        message: body.validator?.message ?? body.error ?? '',
      });
      const sres = await fetch(`/api/onboarding/state?tenantId=${tenantId}`);
      if (sres.ok) {
        setState(await sres.json());
      }
    } catch (e) {
      setResult({ status: 'failed', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  async function defer(): Promise<void> {
    await fetch('/api/onboarding/defer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tenantId,
        category: category.id,
        reason: 'customer-skipped',
      }),
    });
    const sres = await fetch(`/api/onboarding/state?tenantId=${tenantId}`);
    if (sres.ok) {
      setState(await sres.json());
    }
  }

  const completedCount = state.steps.filter(
    (s) => s.category.required && (s.status === 'passed' || s.status === 'deferred'),
  ).length;
  const progressPercent = Math.round((completedCount / 15) * 100);

  return (
    <main
      style={{
        maxWidth: 960,
        margin: '40px auto',
        padding: 24,
        background: 'white',
        borderRadius: 12,
        boxShadow: '0 1px 2px rgba(0,0,0,.06)',
      }}
      data-testid="wizard"
    >
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0 }}>Onboarding</h1>
        <div
          aria-label="overall progress"
          data-testid="progress"
          style={{
            marginTop: 8,
            height: 6,
            background: '#e2e8f0',
            borderRadius: 3,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${progressPercent}%`,
              background: '#10b981',
              transition: 'width .2s',
            }}
          />
        </div>
        <p style={{ marginTop: 6, fontSize: 13, color: '#475569' }}>
          {completedCount} of 15 required categories complete.
          {state.ready ? ' ✅ Ready to finalize.' : ''}
        </p>
      </header>

      <section style={{ display: 'flex', gap: 24 }}>
        <aside style={{ flex: '0 0 240px' }}>
          <ol style={{ paddingLeft: 0, listStyle: 'none' }} data-testid="step-list">
            {state.steps.map((s) => (
              <li
                key={s.category.id}
                data-testid={`step-${s.category.id}`}
                data-status={s.status}
                style={{
                  padding: '6px 8px',
                  borderRadius: 4,
                  background:
                    s.category.id === category.id ? '#eef2ff' : 'transparent',
                  fontSize: 13,
                  color: s.status === 'passed' ? '#065f46' : '#0f172a',
                }}
              >
                <a
                  href={`/onboarding/${s.category.id}`}
                  style={{ color: 'inherit', textDecoration: 'none' }}
                >
                  {s.category.ordinal}. {s.category.label}
                  {s.status === 'passed' ? ' ✅' : ''}
                  {s.status === 'failed' ? ' ❌' : ''}
                  {s.status === 'deferred' ? ' ⏭' : ''}
                </a>
              </li>
            ))}
          </ol>
        </aside>

        <section style={{ flex: 1 }}>
          <h2 style={{ marginTop: 0 }}>
            {category.ordinal}. {category.label}
          </h2>
          <p style={{ color: '#475569' }}>{category.description}</p>

          <label style={{ display: 'block', marginTop: 16, fontWeight: 600 }}>
            Provider
          </label>
          <select
            data-testid="provider-select"
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            style={{
              padding: 8,
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              width: '100%',
              fontSize: 14,
            }}
          >
            {category.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          {provider && !provider.noCredentials &&
            provider.credentialDescriptors.map((d) => (
              <div key={d.keyId} style={{ marginTop: 12 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>
                  {d.keyId}
                </label>
                <input
                  type="password"
                  data-testid={`cred-${d.keyId}`}
                  value={creds[d.keyId] ?? ''}
                  onChange={(e) =>
                    setCreds((c) => ({ ...c, [d.keyId]: e.target.value }))
                  }
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    width: '100%',
                    fontSize: 14,
                  }}
                />
              </div>
            ))}

          {/* category-specific choice fields (free-form) */}
          {category.id === 'identity' && (
            <>
              {(['ownerEmail', 'timezone', 'locale'] as const).map((k) => (
                <div key={k} style={{ marginTop: 12 }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>
                    {k}
                  </label>
                  <input
                    data-testid={`choice-${k}`}
                    value={choices[k] ?? ''}
                    onChange={(e) =>
                      setChoices((c) => ({ ...c, [k]: e.target.value }))
                    }
                    style={{
                      padding: 8,
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      width: '100%',
                      fontSize: 14,
                    }}
                  />
                </div>
              ))}
            </>
          )}

          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <button
              data-testid="submit"
              onClick={submit}
              disabled={submitting}
              style={{
                padding: '10px 16px',
                background: '#1e293b',
                color: 'white',
                borderRadius: 6,
                border: 'none',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              {submitting ? 'Validating…' : 'Validate & continue'}
            </button>
            {!category.required && (
              <button
                data-testid="skip"
                onClick={defer}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  color: '#475569',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Skip for now
              </button>
            )}
          </div>

          {result && (
            <div
              data-testid="result"
              data-status={result.status}
              style={{
                marginTop: 16,
                padding: 12,
                background:
                  result.status === 'passed' ? '#dcfce7' : '#fef2f2',
                color: result.status === 'passed' ? '#065f46' : '#991b1b',
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              {result.status.toUpperCase()}: {result.message ?? ''}
            </div>
          )}
        </section>
      </section>

      {state.ready && (
        <section
          data-testid="ready-banner"
          style={{
            marginTop: 24,
            padding: 16,
            background: '#ecfdf5',
            borderRadius: 8,
          }}
        >
          <strong>All required categories complete.</strong>{' '}
          Your CAIA tenant is ready — onboarding is now <em>finalized</em>.
        </section>
      )}
    </main>
  );
}
