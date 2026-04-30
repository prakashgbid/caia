/**
 * Project filter shortcut — DASH-007 retarget.
 * Redirects to /pipeline/timeline?project=<slug> in the new IA.
 */
import { redirect } from 'next/navigation';

export default function ProjectTimeline({ params }: { params: { slug: string } }) {
  redirect(`/pipeline/timeline?project=${params.slug}`);
}
