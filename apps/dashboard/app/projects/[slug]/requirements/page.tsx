/**
 * Project filter shortcut — DASH-007 retarget.
 * Redirects to /work/requirements?project=<slug> in the new IA.
 */
import { redirect } from 'next/navigation';

export default function ProjectRequirements({ params }: { params: { slug: string } }) {
  redirect(`/work/requirements?project=${params.slug}`);
}
