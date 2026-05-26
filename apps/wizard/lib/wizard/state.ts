/**
 * Wizard state hook + server-side lookup helpers.
 *
 * Two surfaces:
 *
 *   - `useWizardState(projectId)` — client-side React hook (SWR-backed)
 *     that polls `/api/wizard/[projectId]/state`. Exposes `state`,
 *     `currentStepIndex`, `isLoading`, `error`, `mutate`.
 *
 *   - `getWizardState(projectId, deps)` — server-side helper used by the
 *     route handler. Reads the project's current ProjectState via the
 *     `@caia/state-machine` store. Pure async; no React deps.
 *
 * The hook + server helper share a JSON shape (`WizardStateSnapshot`) so
 * SWR's cache and the server response are isomorphic.
 *
 * Reuse-first compliance:
 *   - Reuses `@caia/state-machine`'s `StateStore` + `ProjectState` —
 *     no parallel FSM in this app.
 *   - Reuses `swr` (already a workspace dep).
 */

'use client';

import useSWR from 'swr';
import type { ProjectState } from '@caia/state-machine';
import { stepIndexForState } from './steps';

export interface WizardStateSnapshot {
  projectId: string;
  state: ProjectState;
  /** 1-based step index per WIZARD_STEPS, or null if state outside wizard. */
  currentStepIndex: number | null;
  /** ISO timestamp of the FSM transition that produced `state`. */
  updatedAtIso: string;
}

async function fetcher(url: string): Promise<WizardStateSnapshot> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`wizard state fetch failed: HTTP ${res.status}`);
  }
  return (await res.json()) as WizardStateSnapshot;
}

export interface UseWizardStateResult {
  snapshot: WizardStateSnapshot | undefined;
  currentStepIndex: number | null;
  isLoading: boolean;
  error: Error | undefined;
  mutate: () => Promise<WizardStateSnapshot | undefined>;
}

/**
 * Polls `/api/wizard/<projectId>/state` every 5 seconds + revalidates
 * on focus. Wraps SWR so callers don't have to thread the key.
 */
export function useWizardState(projectId: string): UseWizardStateResult {
  const key = projectId ? `/api/wizard/${projectId}/state` : null;
  const { data, error, isLoading, mutate } = useSWR<WizardStateSnapshot, Error>(
    key,
    fetcher,
    {
      refreshInterval: 5_000,
      revalidateOnFocus: true,
      shouldRetryOnError: true,
    },
  );
  return {
    snapshot: data,
    currentStepIndex: data ? data.currentStepIndex : null,
    isLoading,
    error: error ?? undefined,
    mutate: async () => mutate(),
  };
}

// ───────────────────────────────────────────────────────────────────────
// Server-side surface — re-exported from this file because the spec
// asked for "`useWizardState` hook + server-side `getWizardState`" living
// together. Server consumers import from `./state.server.js` to avoid
// pulling React into the server bundle.
// ───────────────────────────────────────────────────────────────────────

export { stepIndexForState };
