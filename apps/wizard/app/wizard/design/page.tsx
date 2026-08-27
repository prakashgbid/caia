/**
 * Wizard Step 6 — Design. Currently a DEMO PREVIEW; live click-through
 * generator is the next major feature build.
 */

import { DemoStepPreview } from '../../../components/wizard/DemoStepPreview';

export const dynamic = 'force-dynamic';

export default async function DesignPage(): Promise<React.JSX.Element> {
  return (
    <DemoStepPreview
      step="design"
      stepNumber={6}
      title="Design"
      description="CAIA generates a click-through mockup from your Proposal + IA — component library selection, style guide, and mock-data flows you can walk through."
      features={[
        'Component library + design tokens picked to match your product tone',
        'Wireframe drafts for every page in the IA',
        'Mock-data flows you can click through end-to-end before we write any code',
        'Reference designs from apps whose feel you liked',
      ]}
      nextStep="Atlas"
      nextStepSlug="atlas"
    />
  );
}
