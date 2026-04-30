/**
 * Project filter shortcut — DASH-007 retarget.
 * Redirects to /work/questions?project=<slug> in the new IA.
 */
import { redirect } from 'next/navigation';

export default function ProjectQuestions({ params }: { params: { slug: string } }) {
  redirect(`/work/questions?project=${params.slug}`);
}
