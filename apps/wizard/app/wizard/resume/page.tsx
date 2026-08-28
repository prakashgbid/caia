/**
 * /wizard/resume?p=<projectId> — hydrate the given project id (from server
 * if logged in, else from localStorage) and redirect to the current stage.
 */

import { ResumePanel } from '../../../components/wizard/ResumePanel';

export const dynamic = 'force-dynamic';

interface Props { searchParams?: Promise<{ p?: string }>; }

export default async function ResumePage(props: Props): Promise<React.JSX.Element> {
  const params = props.searchParams ? await props.searchParams : {};
  return <ResumePanel projectId={params.p || 'anon'} />;
}
