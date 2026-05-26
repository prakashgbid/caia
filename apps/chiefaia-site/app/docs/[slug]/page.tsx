/**
 * Generic /docs/<slug> stub. Generates a static route per
 * `docsCategories` entry. Each renders a "Coming soon" placeholder.
 *
 * Operator's rule: no fabricated content. So the body is intentionally
 * minimal — it acknowledges the topic and tells the visitor the page is
 * being written. Once a guide is authored, it lands here.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  buttonVariants,
  cn,
} from '@caia/ui';
import { docsCategories } from '../../../lib/site-config';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return docsCategories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = docsCategories.find((c) => c.slug === slug);
  if (!category) return { title: 'Not found' };
  return {
    title: category.title,
    description: category.description,
    alternates: { canonical: `/docs/${category.slug}` },
  };
}

export default async function DocsCategoryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const category = docsCategories.find((c) => c.slug === slug);
  if (!category) notFound();

  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <Link
          href="/docs"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← All docs
        </Link>
        <div className="flex items-center gap-3">
          <Badge variant="outline">Coming soon</Badge>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            /docs/{category.slug}
          </p>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          {category.title}
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          {category.description}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>This page is being written</CardTitle>
          <CardDescription>
            We&apos;re keeping the URL stable so deep links don&apos;t break later. The
            authoring is in progress; check the changelog for updates.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href="/changelog"
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            See the changelog
          </Link>
        </CardContent>
      </Card>
    </article>
  );
}

export const dynamic = 'force-static';
