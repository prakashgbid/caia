/**
 * Wizard Step 3 — Interview → Intake (template-driven).
 *
 * The chat-style interviewer was replaced 2026-08-26 with a deterministic
 * template-driven intake per operator direction: one big textarea → analyzer
 * fills what it can → shows an exact number of gap questions with 4 MC + 5th
 * "type my own" → Stage-A summary card. Old chat kept at
 * components/wizard/InterviewChat.tsx.chat.bak for rollback.
 */

import { IntakePanel } from '../../../components/wizard/IntakePanel';

export const dynamic = 'force-dynamic';

export default async function IntakePage(): Promise<React.JSX.Element> {
  return <IntakePanel />;
}
