/**
 * Wizard Step 5 — Proposal.
 *
 * Public demo path uses the ProposalPanel client component which calls
 * POST /api/wizard/proposal/demo (OpenRouter free-tier backed).
 * The backend-real, multi-turn, pillar-tracked generator lives under
 * /wizard/proposal/[projectId] and /api/wizard/proposal/generate.
 */

import { ProposalPanel } from '../../../components/wizard/ProposalPanel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ idea?: string }>;
}

export default async function ProposalPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await Promise.resolve(searchParams);
  const initialIdea = typeof sp.idea === 'string' ? sp.idea : undefined;
  return <ProposalPanel initialIdea={initialIdea} />;
}
