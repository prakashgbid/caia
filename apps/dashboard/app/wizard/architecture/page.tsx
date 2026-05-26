/**
 * Customer wizard — Step 4: Information architecture.
 *
 * Trigger button → runs `@caia/info-architect`'s `runInformationArchitecture`
 * orchestrator → renders the three canonical artifacts (pages-catalogue,
 * design-system, components-library) as collapsible accordion cards.
 *
 * Exit criteria:
 *   - Customer reviews → presses "Looks good, continue"
 *   - Dispatches FSM `information-architecture-in-progress → information-architecture-complete`
 *   - Redirects to `/wizard/proposal` (sibling task's responsibility — we
 *     just push the route).
 *
 * Loading state during the IA run (Claude call — 30-60s). On failure we
 * surface the error and let the user retry.
 *
 * Subscription-only contract: see `_lib/ia-bridge.ts`.
 *
 * Sibling-task coordination: only owns
 * `apps/dashboard/app/wizard/architecture/**`.
 */
'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { ArtifactCards, type IaArtifacts } from './_components/ArtifactCards';
import { Button, Card, CardContent, CardHeader } from './_components/ui';
import { runIaAction } from './actions';
import {
  dispatchFsmTransition,
  IA_FROM,
  IA_TO,
} from './_lib/fsm';
import type { RunIaResult } from './_lib/ia-bridge';

export interface ArchitectureWizardPageProps {
  readonly projectId?: string;
  readonly tenantSlug?: string;
  /** Override for tests — defaults to the server action / FSM dispatch. */
  readonly api?: {
    readonly runIa: typeof runIaAction;
    readonly fsm: typeof dispatchFsmTransition;
  };
  /** Override for tests — defaults to next/navigation router push. */
  readonly onComplete?: (artifacts: IaArtifacts) => void;
}

type Phase = 'idle' | 'running' | 'ready' | 'finalizing' | 'complete' | 'error';

export default function ArchitectureWizardPage(
  props: ArchitectureWizardPageProps = {},
) {
  const router = useRouter();
  // E2E escape hatch: if window.__caiaArchitectureTestApi is set the
  // page uses it instead of the real server action. Set only by the
  // Playwright spec via page.addInitScript — undefined in production.
  const testApi =
    typeof window !== 'undefined'
      ? (window as unknown as {
          __caiaArchitectureTestApi?: ArchitectureWizardPageProps['api'];
        }).__caiaArchitectureTestApi
      : undefined;
  const api =
    props.api ?? testApi ?? { runIa: runIaAction, fsm: dispatchFsmTransition };
  const projectId = props.projectId ?? 'demo-project';
  const tenantSlug = props.tenantSlug ?? 'demo-tenant';

  const [phase, setPhase] = React.useState<Phase>('idle');
  const [artifacts, setArtifacts] = React.useState<IaArtifacts | null>(null);
  const [result, setResult] = React.useState<RunIaResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = React.useState<number>(0);

  // Elapsed-time ticker while the agent runs (so the loading state shows
  // a moving counter — agent calls regularly take 30-60s).
  React.useEffect(() => {
    if (phase !== 'running') return;
    const started = Date.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - started);
    }, 500);
    return () => window.clearInterval(id);
  }, [phase]);

  const handleGenerate = React.useCallback(async () => {
    setError(null);
    setPhase('running');
    try {
      const res = await api.runIa({ projectId, tenantSlug });
      setResult(res);
      setArtifacts({
        pagesCatalogue: res.output.pagesCatalogue,
        designSystem: res.output.designSystem,
        componentsLibrary: res.output.componentsLibrary,
      });
      setPhase('ready');
    } catch (err) {
      setError(`Information architecture failed: ${(err as Error).message}`);
      setPhase('error');
    }
  }, [api, projectId, tenantSlug]);

  const handleAccept = React.useCallback(async () => {
    if (!artifacts) return;
    setPhase('finalizing');
    try {
      await api.fsm({
        projectId,
        from: IA_FROM,
        to: IA_TO,
        reason: 'wizard-architecture-step-accepted',
        payload: result
          ? {
              iaRevisionId: result.iaRevisionId,
              writtenAtIso: result.writtenAtIso,
            }
          : undefined,
      });
      setPhase('complete');
      if (props.onComplete) {
        props.onComplete(artifacts);
      } else {
        router.push('/wizard/proposal');
      }
    } catch (err) {
      setError(`Failed to advance FSM: ${(err as Error).message}`);
      setPhase('error');
    }
  }, [api, artifacts, projectId, props, result, router]);

  const handleRetry = React.useCallback(() => {
    setError(null);
    setArtifacts(null);
    setResult(null);
    setPhase('idle');
  }, []);

  return (
    <div
      data-testid="wizard-architecture-page"
      data-phase={phase}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        maxWidth: 920,
        margin: '0 auto',
      }}
    >
      <Card>
        <CardHeader>Information architecture</CardHeader>
        <CardContent>
          <p
            style={{
              color: '#cbd5e0',
              fontSize: 14,
              marginBottom: 16,
              lineHeight: 1.5,
            }}
          >
            We&apos;ll turn your business plan into three structural artifacts:
            a <strong>pages catalogue</strong> (sitemap + section stacks), a{' '}
            <strong>design system</strong> (tokens + theming), and a{' '}
            <strong>components library</strong> (Atomic-Design catalogue with
            stable IDs). The first pass takes 30–60 seconds.
          </p>

          {phase === 'idle' ? (
            <Button
              data-testid="generate-ia-button"
              onClick={() => void handleGenerate()}
            >
              Generate information architecture
            </Button>
          ) : null}

          {phase === 'running' ? (
            <div
              data-testid="ia-loading"
              role="status"
              aria-live="polite"
              style={{
                padding: 16,
                background: '#1e293b',
                borderRadius: 8,
                color: '#cbd5e0',
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                Running the information architect…
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                Elapsed{' '}
                <span data-testid="ia-elapsed">{Math.floor(elapsedMs / 1000)}</span>s
                · expected 30–60s
              </div>
            </div>
          ) : null}

          {phase === 'error' ? (
            <div
              role="alert"
              data-testid="ia-error"
              style={{
                padding: 12,
                background: '#7f1d1d',
                color: '#fee2e2',
                borderRadius: 6,
                marginBottom: 12,
              }}
            >
              {error}
              <div style={{ marginTop: 12 }}>
                <Button
                  variant="secondary"
                  data-testid="ia-retry"
                  onClick={handleRetry}
                >
                  Try again
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {artifacts ? (
        <div data-testid="ia-artifacts-container">
          <ArtifactCards artifacts={artifacts} />
          <div
            style={{
              display: 'flex',
              gap: 8,
              marginTop: 16,
              alignItems: 'center',
            }}
          >
            <Button
              data-testid="accept-ia-button"
              onClick={() => void handleAccept()}
              disabled={phase === 'finalizing' || phase === 'complete'}
            >
              {phase === 'finalizing'
                ? 'Saving…'
                : phase === 'complete'
                  ? 'Continuing…'
                  : 'Looks good, continue'}
            </Button>
            <Button
              variant="secondary"
              data-testid="regenerate-ia-button"
              onClick={() => void handleGenerate()}
              disabled={phase === 'finalizing' || phase === 'complete'}
            >
              Regenerate
            </Button>
            {phase === 'complete' ? (
              <span
                data-testid="ia-completion-banner"
                style={{
                  color: '#34d399',
                  fontSize: 13,
                  marginLeft: 'auto',
                }}
              >
                Architecture approved — advancing to proposal…
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
