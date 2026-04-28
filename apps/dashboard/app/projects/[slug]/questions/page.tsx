import { redirect } from 'next/navigation';

export default function ProjectQuestions({ params }: { params: { slug: string } }) {
  redirect(`/questions?project=${params.slug}`);
}
