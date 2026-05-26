'use client';
/**
 * `<GrandIdeaStepBridge>` — `'use client'` shim that mounts
 * `GrandIdeaForm` from `@caia/grand-idea/ui-component` and dispatches
 * the FSM transition once the form reports a successful capture.
 *
 * The wrapping page renders inside a `@caia/ui` Card (in
 * `app/wizard/grand-idea/page.tsx`). This bridge does NOT add another
 * Card around `<GrandIdeaForm>` because the form is intentionally
 * inline-styled (see the form's file header — its design is locked).
 *
 * FSM advance:
 *   - PATCH `/api/wizard/[projectId]/state` with
 *     `{ targetState: 'idea-captured', reason: 'grand-idea-captured' }`.
 *   - On 409 (transition already happened), we surface a soft "already
 *     captured" message instead of an error — that path mirrors the
 *     idempotent `advanceToIdeaCaptured` semantics from
 *     `@caia/grand-idea/state-machine`.
 */

import { useCallback, useState } from 'react';
import { GrandIdeaForm } from '@caia/grand-idea/ui-component';
import type { CaptureResponseOk } from '@caia/grand-idea';

export interface GrandIdeaStepBridgeProps {
  projectId: string;
  tenantSlug: string;
  /** Override the global fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Hook for tests / parent components after the FSM advance lands. */
  onAdvanced?: (info: { applied: boolean; alreadyCaptured: boolean }) => void;
}

export function GrandIdeaStepBridge(props: GrandIdeaStepBridgeProps): React.JSX.Element {
  const { projectId, tenantSlug, fetchImpl, onAdvanced } = props;
  const fetchFn = fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const [advanceState, setAdvanceState] = useState<
    | { kind: 'idle' }
    | { kind: 'advancing' }
    | { kind: 'advanced' }
    | { kind: 'already-captured' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const handleCaptured = useCallback(
    async (_resp: CaptureResponseOk) => {
      setAdvanceState({ kind: 'advancing' });
      try {
        const res = await fetchFn(`/api/wizard/${projectId}/state`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            targetState: 'idea-captured',
            reason: 'grand-idea-captured',
          }),
        });
        if (res.status === 409) {
          setAdvanceState({ kind: 'already-captured' });
          onAdvanced?.({ applied: false, alreadyCaptured: true });
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setAdvanceState({ kind: 'advanced' });
        onAdvanced?.({ applied: true, alreadyCaptured: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setAdvanceState({ kind: 'error', message });
      }
    },
    [fetchFn, onAdvanced, projectId],
  );

  return (
    <div data-testid="grand-idea-step-bridge">
      <GrandIdeaForm
        tenantSlug={tenantSlug}
        projectId={projectId}
        onCaptured={handleCaptured}
        {...(fetchImpl ? { fetchImpl } : {})}
      />
      {advanceState.kind === 'advancing' && (
        <div data-testid="advance-status" style={{ marginTop: 12, fontSize: 13 }}>
          Advancing to interview…
        </div>
      )}
      {advanceState.kind === 'advanced' && (
        <div
          data-testid="advance-success"
          style={{ marginTop: 12, fontSize: 13, color: '#065f46' }}
        >
          Idea captured — interview step unlocked.
        </div>
      )}
      {advanceState.kind === 'already-captured' && (
        <div
          data-testid="advance-already"
          style={{ marginTop: 12, fontSize: 13, color: '#475569' }}
        >
          Idea was already captured — interview step is reachable.
        </div>
      )}
      {advanceState.kind === 'error' && (
        <div data-testid="advance-error" style={{ marginTop: 12, color: '#b91c1c', fontSize: 13 }}>
          {advanceState.message}
        </div>
      )}
    </div>
  );
}
