/**
 * Wizard Stage — Design system, style guide, theme picker.
 *
 * Required stage between Landing and Build. The scaffold + screen
 * generators read spec.design and produce code matching the chosen
 * design system + theme, so this cannot be skipped.
 */

import { DesignStagePanel } from '../../../components/wizard/DesignStagePanel';

export const dynamic = 'force-dynamic';

export default function DesignPage(): React.JSX.Element {
  return <DesignStagePanel />;
}
