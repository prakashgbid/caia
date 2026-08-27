/**
 * Wizard Step 6 — Landing Page Preview.
 */

import { LandingPanel } from '../../../components/wizard/LandingPanel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ idea?: string; proposal?: string }>;
}

export default async function LandingPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await Promise.resolve(searchParams);
  return <LandingPanel initialIdea={sp.idea} initialProposal={sp.proposal} />;
}
