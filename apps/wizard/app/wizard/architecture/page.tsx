/**
 * Wizard Step 7 — Atlas (Architecture).
 * Demo-mode preview per CAIA-402/405/406. Original at .backend-real.tsx.bak.
 */

import { DemoStepPreview } from '../../../components/wizard/DemoStepPreview';

export const dynamic = 'force-dynamic';

export default async function ArchitecturePage(): Promise<React.JSX.Element> {
  return (
    <DemoStepPreview
      step="architecture"
      stepNumber={7}
      title="Atlas (Architecture)"
      description={"Final CAIA architecture ratification: tech stack, deployment model, observability, security, and factory dispatch plan."}
      features={["Full tech stack and rationale (chosen from ratified ADRs)", "Deployment model (per-app dedicated infrastructure)", "Observability, SLOs, on-call plan", "Handoff to the CAIA factory for build execution"]}
      nextStep="Done"
    />
  );
}
