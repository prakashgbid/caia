/**
 * Wizard Step 3 — Interview.
 *
 * Public demo mode uses the interactive InterviewChat client component
 * against POST /api/wizard/interview/demo (OpenRouter free-tier backed).
 *
 * The backend-real path (multi-tenant, pillar-tracked, DB-persisted) lives
 * under /wizard/interview/[projectId] and requires a real projectId + tenant.
 */

import { InterviewChat } from '../../../components/wizard/InterviewChat';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ idea?: string }>;
}

export default async function InterviewPage({ searchParams }: PageProps): Promise<React.JSX.Element> {
  const sp = await Promise.resolve(searchParams);
  const initialIdea = typeof sp.idea === 'string' ? sp.idea : undefined;
  return <InterviewChat initialIdea={initialIdea} />;
}
