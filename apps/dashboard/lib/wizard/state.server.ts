/**
 * Server-only `getWizardState(projectId, deps)`.
 *
 * Lives in a separate file from `state.ts` so the client bundle never
 * imports `pg` / `@caia/state-machine/pg-store` transitively through
 * the React hook.
 *
 * Reuse-first compliance:
 *   - Uses `@caia/state-machine`'s `StateStore` interface for the lookup.
 *   - Caller injects the store, so this stays trivially testable.
 */

import type { ProjectState, StateStore } from '@caia/state-machine';
import { stepIndexForState } from './steps.js';
import type { WizardStateSnapshot } from './state.js';

export interface GetWizardStateDeps {
  store: StateStore;
}

export class ProjectNotFoundError extends Error {
  constructor(public readonly projectId: string) {
    super(`Project not found: ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export async function getWizardState(
  projectId: string,
  deps: GetWizardStateDeps,
): Promise<WizardStateSnapshot> {
  // The `@caia/state-machine` StateStore exposes `loadProject(id)`. We
  // structurally narrow to avoid coupling to the full StateStore surface
  // — only the bits we use.
  const store = deps.store as unknown as {
    loadProject(id: string): Promise<
      | {
          status: ProjectState;
          updatedAt: Date | string;
        }
      | null
    >;
  };
  const row = await store.loadProject(projectId);
  if (!row) {
    throw new ProjectNotFoundError(projectId);
  }
  const updatedAt =
    row.updatedAt instanceof Date
      ? row.updatedAt.toISOString()
      : new Date(row.updatedAt).toISOString();
  return {
    projectId,
    state: row.status,
    currentStepIndex: stepIndexForState(row.status),
    updatedAtIso: updatedAt,
  };
}
