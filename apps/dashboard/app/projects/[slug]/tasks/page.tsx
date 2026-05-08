import { redirect } from 'next/navigation';

export default async function ProjectTasks({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/tasks?project=${slug}`);
}
