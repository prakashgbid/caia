import { redirect } from 'next/navigation';

export default async function ProjectBlockers({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/blockers?project=${slug}`);
}
