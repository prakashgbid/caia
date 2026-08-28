/**
 * / — Dashboard root. Shows existing projects + New Project CTA.
 *
 * If the visitor has no prior projects (local or remote), we still
 * DON'T auto-start a project; we let them opt in via the New Project
 * modal so the first click is intentional.
 */

import { ProjectsLanding } from '../components/wizard/ProjectsLanding';

export const dynamic = 'force-dynamic';

export default function Home(): React.JSX.Element {
  return <ProjectsLanding />;
}
