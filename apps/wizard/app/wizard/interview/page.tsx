/**
 * Wizard Step 3 — Interview.
 * Demo-mode preview per CAIA-402/405/406. Original at .backend-real.tsx.bak.
 */

import { DemoStepPreview } from '../../../components/wizard/DemoStepPreview';

export const dynamic = 'force-dynamic';

export default async function InterviewPage(): Promise<React.JSX.Element> {
  return (
    <DemoStepPreview
      step="interview"
      stepNumber={3}
      title="Interview"
      description={"The CAIA Interviewer runs a structured Q&A to sharpen your idea. Coverage across 12 dimensions (customer, competition, monetisation, tech, moat, etc.) with critic feedback."}
      features={["Multi-turn dialogue with the CAIA Interviewer agent", "12-dimension coverage tracker (customer, competition, monetisation, tech, moat, etc.)", "Critic feedback with approved-with-modifications vs coverage-insufficient labels", "Accumulated Q&A thread persisted per tenant"]}
      nextStep="Information Architecture"
    />
  );
}
