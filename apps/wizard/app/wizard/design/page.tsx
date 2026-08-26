/**
 * Wizard Step 6 — Design.
 * Demo-mode preview per CAIA-402/405/406. Original at .backend-real.tsx.bak.
 */

import { DemoStepPreview } from '../../../components/wizard/DemoStepPreview';

export const dynamic = 'force-dynamic';

export default async function DesignPage(): Promise<React.JSX.Element> {
  return (
    <DemoStepPreview
      step="design"
      stepNumber={6}
      title="Design"
      description={"CAIA generates initial design ingestion: wireframes, component library selection, style guide."}
      features={["Wireframe drafts for every page in the IA", "Component library selection (@caia/ui or custom)", "Style guide (palette, typography, spacing)", "Reference designs pulled from your competitor list"]}
      nextStep="Atlas"
    />
  );
}
