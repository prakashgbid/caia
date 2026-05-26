/**
 * /blog — index of posts. Single placeholder post on launch.
 *
 * No fabricated author bylines — the rule is operator-locked. The publisher
 * (the company) is the implicit byline.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Badge,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@caia/ui';
import { getAllPosts } from '../../lib/blog';
import { siteConfig } from '../../lib/site-config';

export const metadata: Metadata = {
  title: 'Blog',
  description:
    'Updates, design notes, and architecture decisions from the ChiefAIA team. Operator-confirmed content only.',
  alternates: { canonical: '/blog' },
};

export const dynamic = 'force-static';

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Blog
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          From the {siteConfig.name} team
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          Long-form posts about the pipeline, the agents, and the gates.
        </p>
      </header>

      <ul className="space-y-4">
        {posts.map((post) => (
          <li key={post.slug}>
            <Link
              href={`/blog/${post.slug}`}
              className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Card className="transition-colors hover:bg-accent">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="outline">
                      <time dateTime={post.publishedAt}>{post.publishedAt}</time>
                    </Badge>
                    <CardTitle>{post.title}</CardTitle>
                  </div>
                  <CardDescription>{post.description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
