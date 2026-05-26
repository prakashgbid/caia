'use client';
/**
 * `<OnboardingStepForm>` — client-side stepper for the 19 onboarding
 * categories. Walks the canonical catalog produced server-side by the
 * page, captures provider + credentials per step, and PATCHes the FSM
 * state from `onboarding` → `idea-captured` once every mandatory
 * category is `passed` or `deferred`.
 *
 * Reuse-first compliance:
 *   - UI: `@caia/ui` primitives only (Card, Button, Input, Badge,
 *     Progress).
 *   - Domain shape: the `categories` prop comes from
 *     `@caia/onboarding`'s `ALL_CATEGORIES` (the page projects it down
 *     to the JSON-serializable subset the client needs).
 *
 * The actual credential submission posts to a per-category API route
 * (Wave 2 — `/api/onboarding/submit-step`) that wraps the
 * `OnboardingEngine.submitStep` call. For the V1 wizard surface we keep
 * a deterministic in-memory cursor + a "Mark validated" CTA that drives
 * the same per-step status transitions the engine would, so the page is
 * reachable and testable end-to-end while the persistence layer
 * stabilizes.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Progress,
} from '@caia/ui';

export interface OnboardingStepFormCategory {
  id: string;
  label: string;
  ordinal: number;
  required: boolean;
  description: string;
  providers: ReadonlyArray<{
    id: string;
    label: string;
    archetype: string;
    noCredentials: boolean;
    credentialDescriptors: ReadonlyArray<{
      keyId: string;
      archetype: string;
      scopesRequired: ReadonlyArray<string>;
      storeSecret: boolean;
    }>;
  }>;
}

export interface OnboardingStepFormProps {
  projectId: string;
  categories: ReadonlyArray<OnboardingStepFormCategory>;
  /** Override the global fetch (tests / SSR). */
  fetchImpl?: typeof fetch;
  /** Called after the FSM advance completes. */
  onComplete?: () => void;
}

type StepStatus = 'pending' | 'passed' | 'deferred' | 'failed';

interface CategoryState {
  status: StepStatus;
  providerId?: string;
  failureReason?: string;
}

export function OnboardingStepForm(props: OnboardingStepFormProps): React.JSX.Element {
  const { projectId, categories, fetchImpl, onComplete } = props;
  const fetchFn = useMemo<typeof fetch>(
    () => fetchImpl ?? ((...args) => fetch(...args)),
    [fetchImpl],
  );

  const [statuses, setStatuses] = useState<Record<string, CategoryState>>(() =>
    Object.fromEntries(categories.map((c) => [c.id, { status: 'pending' as StepStatus }])),
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const [credentialDraft, setCredentialDraft] = useState<Record<string, string>>({});
  const [providerDraft, setProviderDraft] = useState<string>('');
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [advanceMessage, setAdvanceMessage] = useState<string | null>(null);

  const active = categories[activeIndex];
  const totalDone = useMemo(
    () =>
      categories.filter(
        (c) => statuses[c.id]?.status === 'passed' || statuses[c.id]?.status === 'deferred',
      ).length,
    [categories, statuses],
  );

  const mandatoryRemaining = useMemo(
    () =>
      categories.filter(
        (c) =>
          c.required &&
          statuses[c.id]?.status !== 'passed' &&
          statuses[c.id]?.status !== 'deferred',
      ),
    [categories, statuses],
  );

  const allMandatoryDone = mandatoryRemaining.length === 0;

  const setCategory = useCallback((id: string, next: CategoryState) => {
    setStatuses((prev) => ({ ...prev, [id]: next }));
  }, []);

  const onPickProvider = useCallback((id: string) => {
    setProviderDraft(id);
    setCredentialDraft({});
  }, []);

  const onCredentialChange = useCallback((keyId: string, value: string) => {
    setCredentialDraft((d) => ({ ...d, [keyId]: value }));
  }, []);

  const submit = useCallback(() => {
    if (!active) return;
    const chosenProvider = active.providers.find((p) => p.id === providerDraft);
    if (!chosenProvider) {
      setCategory(active.id, {
        status: 'failed',
        failureReason: 'pick a provider before continuing',
      });
      return;
    }
    if (!chosenProvider.noCredentials) {
      for (const desc of chosenProvider.credentialDescriptors) {
        const value = credentialDraft[desc.keyId];
        if (!value || value.trim().length === 0) {
          setCategory(active.id, {
            status: 'failed',
            failureReason: `missing credential: ${desc.keyId}`,
          });
          return;
        }
      }
    }
    setCategory(active.id, { status: 'passed', providerId: chosenProvider.id });
    setProviderDraft('');
    setCredentialDraft({});
    if (activeIndex + 1 < categories.length) {
      setActiveIndex(activeIndex + 1);
    }
  }, [active, activeIndex, categories.length, credentialDraft, providerDraft, setCategory]);

  const defer = useCallback(() => {
    if (!active) return;
    if (active.required) {
      setCategory(active.id, {
        status: 'failed',
        failureReason: 'mandatory categories cannot be deferred',
      });
      return;
    }
    setCategory(active.id, { status: 'deferred' });
    setProviderDraft('');
    setCredentialDraft({});
    if (activeIndex + 1 < categories.length) {
      setActiveIndex(activeIndex + 1);
    }
  }, [active, activeIndex, categories.length, setCategory]);

  const dispatchFsm = useCallback(async () => {
    if (!allMandatoryDone) {
      setAdvanceError(
        `still ${mandatoryRemaining.length} required category(ies) outstanding`,
      );
      return;
    }
    setAdvancing(true);
    setAdvanceError(null);
    try {
      const res = await fetchFn(`/api/wizard/${projectId}/state`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetState: 'idea-captured',
          reason: 'onboarding-complete',
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setAdvanceMessage('Onboarding complete — advancing to Grand Idea.');
      onComplete?.();
    } catch (err) {
      setAdvanceError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdvancing(false);
    }
  }, [allMandatoryDone, fetchFn, mandatoryRemaining.length, onComplete, projectId]);

  if (!active) {
    return (
      <Card data-testid="onboarding-empty">
        <CardHeader>
          <CardTitle>Nothing to do</CardTitle>
          <CardDescription>No categories were provided.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div data-testid="onboarding-step-form">
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 13, opacity: 0.8 }}>
            {totalDone} of {categories.length} categories complete
          </span>
          <span style={{ fontSize: 13, opacity: 0.8 }}>
            {mandatoryRemaining.length} required outstanding
          </span>
        </div>
        <Progress value={totalDone} max={categories.length} aria-label="onboarding progress" />
      </div>

      <Card data-testid={`onboarding-category-${active.id}`}>
        <CardHeader>
          <CardTitle>
            {active.ordinal}. {active.label}{' '}
            <Badge variant={active.required ? 'default' : 'secondary'} data-testid="required-badge">
              {active.required ? 'required' : 'optional'}
            </Badge>
          </CardTitle>
          <CardDescription>{active.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Provider
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {active.providers.map((p) => (
                <Button
                  key={p.id}
                  variant={providerDraft === p.id ? 'default' : 'outline'}
                  onClick={() => onPickProvider(p.id)}
                  data-testid={`provider-${p.id}`}
                  type="button"
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
          {providerDraft &&
            active.providers
              .find((p) => p.id === providerDraft)
              ?.credentialDescriptors.map((d) => (
                <div key={d.keyId} style={{ marginTop: 12 }}>
                  <label
                    htmlFor={`cred-${d.keyId}`}
                    style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}
                  >
                    {d.keyId} ({d.archetype})
                  </label>
                  <Input
                    id={`cred-${d.keyId}`}
                    data-testid={`cred-${d.keyId}`}
                    type="password"
                    value={credentialDraft[d.keyId] ?? ''}
                    onChange={(e) => onCredentialChange(d.keyId, e.target.value)}
                  />
                </div>
              ))}
          {statuses[active.id]?.status === 'failed' && (
            <div
              data-testid="step-error"
              style={{ marginTop: 12, color: '#b91c1c', fontSize: 13 }}
            >
              {statuses[active.id]?.failureReason}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button
              variant="default"
              onClick={submit}
              data-testid="submit-step"
              type="button"
            >
              Validate & continue
            </Button>
            <Button
              variant="outline"
              onClick={defer}
              data-testid="defer-step"
              type="button"
              disabled={active.required}
            >
              Defer
            </Button>
          </div>
        </CardContent>
      </Card>

      <div style={{ marginTop: 20, display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button
          variant="default"
          onClick={dispatchFsm}
          disabled={!allMandatoryDone || advancing}
          data-testid="advance-fsm"
          type="button"
        >
          {advancing ? 'Advancing…' : 'Finish onboarding'}
        </Button>
        {advanceError && (
          <span data-testid="advance-error" style={{ color: '#b91c1c', fontSize: 13 }}>
            {advanceError}
          </span>
        )}
        {advanceMessage && (
          <span data-testid="advance-message" style={{ color: '#065f46', fontSize: 13 }}>
            {advanceMessage}
          </span>
        )}
      </div>
    </div>
  );
}
