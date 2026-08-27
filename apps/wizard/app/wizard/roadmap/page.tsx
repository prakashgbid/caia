/**
 * /wizard/roadmap — full CAIA factory phases list, grouped Done/Doing/Todo.
 */

import { PhasesRoadmap } from '../../../components/wizard/PhasesRoadmap';

export const dynamic = 'force-dynamic';

export default function RoadmapPage(): React.JSX.Element {
  return <PhasesRoadmap />;
}
