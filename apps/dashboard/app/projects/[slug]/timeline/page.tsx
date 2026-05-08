import { redirect } from 'next/navigation';

export default async function ProjectTimeline({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/timeline?project=${slug}`);
}
