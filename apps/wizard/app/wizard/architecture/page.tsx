/**
 * Wizard Step 4 — Information Architecture.
 *
 * Public demo uses <IAPanel> against POST /api/wizard/ia/demo
 * (OpenRouter free-tier backed). Real backend-real path lives elsewhere.
 */

import { IAPanel } from '../../../components/wizard/IAPanel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ idea?: string }>;
}

export default async function IAPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await Promise.resolve(searchParams);
  const initialIdea = typeof sp.idea === 'string' ? sp.idea : undefined;
  return <IAPanel initialIdea={initialIdea} />;
}
