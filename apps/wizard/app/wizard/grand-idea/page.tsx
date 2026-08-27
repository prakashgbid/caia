/**
 * Wizard Step 2 — Grand Idea.
 * Tailwind-styled brand-consistent form with auto-advance to Interview.
 */

import { GrandIdeaForm } from '../../../components/wizard/GrandIdeaForm';

export const dynamic = 'force-dynamic';

export default async function GrandIdeaPage(): Promise<React.JSX.Element> {
  return <GrandIdeaForm />;
}
