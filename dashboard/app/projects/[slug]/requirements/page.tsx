import { redirect } from 'next/navigation';

export default function ProjectRequirements({ params }: { params: { slug: string } }) {
  redirect(`/requirements?project=${params.slug}`);
}
