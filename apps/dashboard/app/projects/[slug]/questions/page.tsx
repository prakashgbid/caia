import { redirect } from 'next/navigation';

export default async function ProjectQuestions({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/questions?project=${slug}`);
}
