/**
 * Next.js page wrapper for Step 5 — Proposal. The actual UI lives in
 * `components/wizard/ProposalPanel.tsx` so the tests can mount it with
 * prop injections (fetchImpl) without fighting Next.js's required
 * `PageProps` shape.
 */
import { ProposalPanel } from '../../../components/wizard/ProposalPanel';

export const dynamic = 'force-dynamic';

export default function ProposalPage(): React.JSX.Element {
  return <ProposalPanel />;
}
