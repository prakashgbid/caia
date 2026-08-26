/**
 * Wizard Step 5 — Proposal.
 * Demo-mode preview per CAIA-402/405/406. Original at .backend-real.tsx.bak.
 */

import { DemoStepPreview } from '../../../components/wizard/DemoStepPreview';

export const dynamic = 'force-dynamic';

export default async function ProposalPage(): Promise<React.JSX.Element> {
  return (
    <DemoStepPreview
      step="proposal"
      stepNumber={5}
      title="Proposal"
      description={"CAIA drafts a business proposal from the interview and IA. Includes scope, budget, timeline, moat, and success metrics."}
      features={["Executive summary and problem statement", "Scope (in/out) and phased milestones", "Rough budget, team, timeline", "Success metrics, risks, mitigations"]}
      nextStep="Design"
    />
  );
}
