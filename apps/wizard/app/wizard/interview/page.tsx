/**
 * Wizard Stage 3 — Interview: smart-question idea refinement.
 * Real chat UI backed by /api/wizard/interview/refine/{next,synthesise}.
 */

import { IdeaRefinerChat } from '../../../components/wizard/IdeaRefinerChat';

export const dynamic = 'force-dynamic';

export default function InterviewPage(): React.JSX.Element {
  return <IdeaRefinerChat />;
}
