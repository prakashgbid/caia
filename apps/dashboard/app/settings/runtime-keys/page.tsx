'use client';
/**
 * /settings/runtime-keys — BYOK paste UI.
 *
 * Server-side validation. The key value is sent over HTTPS and stored
 * in Infisical. The browser never reads it back; subsequent renders
 * show only `configured: true/false`.
 *
 * UI primitives strictly from `@caia/ui`.
 */

import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Badge,
} from '@caia/ui';

const PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'azure',
  'aws-bedrock',
  'mistral',
  'cohere',
] as const;
type Provider = (typeof PROVIDERS)[number];

interface KeyState {
  configured: boolean | null; // null = unknown / loading
  busy: boolean;
  error: string | null;
  draft: string;
}

const initialState: KeyState = {
  configured: null,
  busy: false,
  error: null,
  draft: '',
};

export default function RuntimeKeysPage() {
  const [state, setState] = useState<Record<Provider, KeyState>>(() => {
    const seed: Record<Provider, KeyState> = {} as Record<Provider, KeyState>;
    for (const p of PROVIDERS) seed[p] = { ...initialState };
    return seed;
  });

  // Initial load — query each provider's configured flag.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const p of PROVIDERS) {
        try {
          const res = await fetch(`/api/billing/runtime-keys/${p}`);
          const data = (await res.json()) as { configured?: boolean };
          if (cancelled) return;
          setState((s) => ({
            ...s,
            [p]: { ...s[p], configured: data.configured ?? false },
          }));
        } catch {
          if (cancelled) return;
          setState((s) => ({
            ...s,
            [p]: { ...s[p], configured: false },
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (p: Provider) => {
    setState((s) => ({ ...s, [p]: { ...s[p], busy: true, error: null } }));
    try {
      const res = await fetch(`/api/billing/runtime-keys/${p}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: state[p].draft }),
      });
      const data = (await res.json()) as { error?: string; detail?: string };
      if (!res.ok) {
        setState((s) => ({
          ...s,
          [p]: { ...s[p], busy: false, error: data.detail ?? data.error ?? 'failed' },
        }));
        return;
      }
      setState((s) => ({
        ...s,
        [p]: { configured: true, busy: false, error: null, draft: '' },
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        [p]: { ...s[p], busy: false, error: (err as Error).message },
      }));
    }
  };

  const revoke = async (p: Provider) => {
    setState((s) => ({ ...s, [p]: { ...s[p], busy: true, error: null } }));
    try {
      const res = await fetch(`/api/billing/runtime-keys/${p}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setState((s) => ({
          ...s,
          [p]: { ...s[p], busy: false, error: data.error ?? 'failed' },
        }));
        return;
      }
      setState((s) => ({
        ...s,
        [p]: { configured: false, busy: false, error: null, draft: '' },
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        [p]: { ...s[p], busy: false, error: (err as Error).message },
      }));
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Runtime keys (BYOK)</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Paste an API key for each provider you want your CAIA-built apps to use
        at runtime. Keys are stored in Infisical, scoped to your tenant, and
        never echoed back to the browser. Each read is audit-logged.
      </p>
      <Tabs defaultValue="anthropic">
        <TabsList>
          {PROVIDERS.map((p) => (
            <TabsTrigger key={p} value={p}>
              {p}
            </TabsTrigger>
          ))}
        </TabsList>
        {PROVIDERS.map((p) => {
          const s = state[p];
          return (
            <TabsContent key={p} value={p}>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {p}
                    {s.configured === true && <Badge>configured</Badge>}
                    {s.configured === false && <Badge variant="secondary">not set</Badge>}
                  </CardTitle>
                  <CardDescription>
                    Server-validated. Stored in Infisical at
                    {' '}<code>tenant_&lt;id&gt;.runtime_credits.{p}_api_key</code>.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Input
                    type="password"
                    autoComplete="off"
                    placeholder={`Paste ${p} API key`}
                    value={s.draft}
                    onChange={(e) =>
                      setState((cur) => ({
                        ...cur,
                        [p]: { ...cur[p], draft: e.target.value },
                      }))
                    }
                    disabled={s.busy}
                  />
                  {s.error && (
                    <p className="text-sm text-destructive">{s.error}</p>
                  )}
                  <div className="flex gap-2">
                    <Button onClick={() => save(p)} disabled={s.busy || !s.draft}>
                      {s.busy ? 'Saving…' : s.configured ? 'Rotate' : 'Save'}
                    </Button>
                    {s.configured && (
                      <Button variant="outline" onClick={() => revoke(p)} disabled={s.busy}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
