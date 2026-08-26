/**
 * Wizard Step 4 — Information Architecture.
 * Demo-mode preview per CAIA-402/405/406. Original at .backend-real.tsx.bak.
 */

import { DemoStepPreview } from '../../../components/wizard/DemoStepPreview';

export const dynamic = 'force-dynamic';

export default async function ArchitecturePage(): Promise<React.JSX.Element> {
  return (
    <DemoStepPreview
      step="architecture"
      stepNumber={4}
      title="Information Architecture"
      description={"The Atlas agent maps entities, pages, and flows for your product. Output feeds directly into the Proposal step."}
      features={["Entity map (User, Session, Order, etc.)", "Page inventory and hierarchy", "Cross-page user flows", "Data model draft ready for the Proposal step"]}
      nextStep="Proposal"
    />
  );
}
