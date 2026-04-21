import { redirect } from 'next/navigation';

export default function ProjectTimeline({ params }: { params: { slug: string } }) {
  redirect(`/timeline?project=${params.slug}`);
}
