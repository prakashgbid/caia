/**
 * Server actions for the architecture step (Next 15 App Router).
 *
 * `runIaAction` drives `@caia/info-architect`'s `runInformationArchitecture`
 * orchestrator. It returns the three canonical artifacts (pages-catalogue,
 * design-system, components-library) wrapped with FSM transition metadata
 * so the client can show a "looks good, continue" CTA.
 */
'use server';

import { runIa, type RunIaInput, type RunIaResult } from './_lib/ia-bridge';

export async function runIaAction(input: RunIaInput): Promise<RunIaResult> {
  return runIa(input);
}
