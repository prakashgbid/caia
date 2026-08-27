/**
 * /wizard/docs/[id] — viewer for a single generated doc.
 */

import { DocViewer } from '../../../../components/wizard/DocViewer';

export const dynamic = 'force-dynamic';

interface Props { params: Promise<{ id: string }>; }

export default async function DocsViewerPage(props: Props): Promise<React.JSX.Element> {
  const p = await props.params;
  return <DocViewer id={p.id} />;
}
