import { redirect } from 'next/navigation';

export default function ProjectTasks({ params }: { params: { slug: string } }) {
  redirect(`/tasks?project=${params.slug}`);
}
