/**
 * Project filter shortcut — DASH-007 retarget.
 * Redirects to /work/tasks?project=<slug> in the new IA.
 */
import { redirect } from 'next/navigation';

export default function ProjectTasks({ params }: { params: { slug: string } }) {
  redirect(`/work/tasks?project=${params.slug}`);
}
