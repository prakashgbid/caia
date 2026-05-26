/**
 * /blog/<slug> — single blog post page. No author byline (operator rule —
 * no fabricated authorship). Publisher is the implicit byline via the
 * Organization JSON-LD in the root layout.
 */

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge } from '@caia/ui';
import { blogPosts, getPost } from '../../../lib/blog';
import { siteConfig } from '../../../lib/site-config';

type Params = { slug: string };

export function generateStaticParams(): Params[] {
  return blogPosts.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) return { title: 'Not found' };
  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      title: post.title,
      description: post.description,
      url: `/blog/${post.slug}`,
      publishedTime: post.publishedAt,
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const post = getPost(slug);
  if (!post) notFound();

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    publisher: {
      '@type': 'Organization',
      name: siteConfig.publisher,
    },
  };

  return (
    <article className="space-y-8">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <header className="space-y-3">
        <Link
          href="/blog"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← All posts
        </Link>
        <div className="flex items-center gap-3">
          <Badge variant="outline">
            <time dateTime={post.publishedAt}>{post.publishedAt}</time>
          </Badge>
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          {post.title}
        </h1>
        <p className="max-w-2xl text-muted-foreground">{post.description}</p>
      </header>
      <div className="prose prose-neutral max-w-prose space-y-4 text-foreground">
        {post.body.split('\n\n').map((para, i) => (
          <p key={i} className="leading-relaxed text-muted-foreground">
            {para}
          </p>
        ))}
      </div>
    </article>
  );
}

export const dynamic = 'force-static';
