/**
 * Next.js page wrapper for Step 6 — Design. The actual UI lives in
 * `components/wizard/DesignPanel.tsx` so the tests can mount the panel
 * with prop injections (fetchImpl / clipboardWriter / etc) without
 * fighting Next.js's required `PageProps` shape.
 */
import { DesignPanel } from '../../../components/wizard/DesignPanel';

export const dynamic = 'force-dynamic';

export default function DesignPage(): React.JSX.Element {
  return <DesignPanel />;
}
