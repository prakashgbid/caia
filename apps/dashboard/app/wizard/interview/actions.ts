/**
 * Server actions for the interview step (Next 15 App Router).
 *
 * The actions wrap `engine-bridge.ts` so the client component can call
 * server-side code without spinning up a separate API route file. Each
 * action mirrors one user-visible operation (`startSessionAction`,
 * `submitTurnAction`, `markDoneAction`). All actions auto-save by
 * delegating to the engine (which writes to `interview_threads` on every
 * turn via `InterviewerPersistence`).
 */
'use server';

import {
  markDone,
  startSession,
  submitTurn,
  type BridgeSession,
  type StartSessionResult,
  type SubmitTurnResult,
} from './_lib/engine-bridge';

export async function startSessionAction(input: {
  tenantSlug: string;
  operatorEmail: string;
  grandIdeaPrompt: string;
}): Promise<StartSessionResult> {
  return startSession(input);
}

export async function submitTurnAction(
  session: BridgeSession,
  userText: string,
): Promise<SubmitTurnResult> {
  return submitTurn(session, userText);
}

export async function markDoneAction(
  session: BridgeSession,
): Promise<SubmitTurnResult> {
  return markDone(session);
}
