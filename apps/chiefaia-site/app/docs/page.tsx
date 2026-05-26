/**
 * /docs — docs index. Cards link to /docs/<slug>; each docs page is a
 * "Coming soon" stub for now. Content is not authored yet — operator's rule
 * forbids fabricated authorship or content.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@caia/ui';
import { docsCategories } from '../../lib/site-config';

export const metadata: Metadata = {
  title: 'Documentation',
  description:
    'Product documentation for ChiefAIA — getting started, the 7-step pipeline, architecture, the agent roster, the evidence gate.',
  alternates: { canonical: '/docs' },
};

export const dynamic = 'force-static';

export default function DocsIndexPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Documentation
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Learn how ChiefAIA works
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          Each guide below lives on its own page so it can deep-link. Content
          for each page is being written — the structure is wired now so the
          information architecture is stable.
        </p>
      </header>

      <section
        aria-label="Documentation categories"
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"
      >
        {docsCategories.map((category) => (
          <Link
            key={category.slug}
            href={`/docs/${category.slug}`}
            className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            data-testid={`docs-card-${category.slug}`}
          >
            <Card className="h-full transition-colors hover:bg-accent">
              <CardHeader>
                <CardTitle>{category.title}</CardTitle>
                <CardDescription>{category.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}
