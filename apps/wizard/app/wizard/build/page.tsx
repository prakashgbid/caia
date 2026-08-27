/**
 * Wizard Step 8 — Split-screen live MVP builder.
 */

import { BuildPanel } from '../../../components/wizard/BuildPanel';

export const dynamic = 'force-dynamic';

interface Props { searchParams?: Promise<{ idea?: string; proposal?: string }>; }

export default async function WizardBuildPage(props: Props): Promise<React.JSX.Element> {
  const params = props.searchParams ? await props.searchParams : {};
  return <BuildPanel initialIdea={params.idea} initialProposal={params.proposal} />;
}
