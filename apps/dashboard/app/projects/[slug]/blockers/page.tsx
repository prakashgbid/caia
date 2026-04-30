/**
 * Project filter shortcut — DASH-007 retarget.
 * Redirects to /work/blockers?project=<slug> in the new IA.
 */
import { redirect } from 'next/navigation';

export default function ProjectBlockers({ params }: { params: { slug: string } }) {
  redirect(`/work/blockers?project=${params.slug}`);
}
