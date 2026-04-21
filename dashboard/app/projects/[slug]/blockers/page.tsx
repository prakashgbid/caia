import { redirect } from 'next/navigation';

export default function ProjectBlockers({ params }: { params: { slug: string } }) {
  redirect(`/blockers?project=${params.slug}`);
}
