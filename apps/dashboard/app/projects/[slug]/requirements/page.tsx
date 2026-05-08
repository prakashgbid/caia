import { redirect } from 'next/navigation';

export default async function ProjectRequirements({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/requirements?project=${slug}`);
}
