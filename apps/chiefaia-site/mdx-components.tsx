/**
 * App Router MDX globals — required at the project root by @next/mdx@15.
 *
 * Maps the default MDX elements (h1, h2, h3, p, ul, ol, li, a, blockquote,
 * hr, code) onto Tailwind utility classes that match the `@caia/ui`
 * typography rhythm. The result: legal MDX files can be written as plain
 * markdown and pick up the marketing-site's heading sizes / line-height /
 * link colours automatically — no per-page typography component required.
 *
 * Why destructure `children` only (no `...rest` spread)? @types/mdx@2 types
 * each MDX-mapped component's props with the legacy `LegacyRef` ref shape,
 * which clashes with React 19's stricter `Ref` type and blows up tsc with
 * "string is not assignable to type Ref<HTMLElement>". The MDX runtime only
 * ever passes `children` to these components — `id`, `className`, etc are
 * never injected — so taking only `children` is both correct and avoids
 * the typing collision until @types/mdx@3 ships React-19-aware shapes.
 *
 * Per ADR-065 reuse-first: we do not fork shadcn primitives here. We only
 * style the raw MDX-emitted HTML tags with Tailwind utility classes that
 * resolve through `@caia/ui`'s design-token CSS variables.
 */

import type { MDXComponents } from 'mdx/types';
import type { ReactNode } from 'react';
import Link from 'next/link';

interface ChildrenOnly {
  children?: ReactNode;
}

interface AnchorMDX extends ChildrenOnly {
  href?: string;
}

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    h1: ({ children }: ChildrenOnly) => (
      <h1 className="mt-0 mb-6 text-4xl font-semibold tracking-tight text-foreground">
        {children}
      </h1>
    ),
    h2: ({ children }: ChildrenOnly) => (
      <h2 className="mt-12 mb-4 text-2xl font-semibold tracking-tight text-foreground">
        {children}
      </h2>
    ),
    h3: ({ children }: ChildrenOnly) => (
      <h3 className="mt-8 mb-3 text-lg font-semibold text-foreground">
        {children}
      </h3>
    ),
    p: ({ children }: ChildrenOnly) => (
      <p className="my-4 leading-7 text-muted-foreground">{children}</p>
    ),
    ul: ({ children }: ChildrenOnly) => (
      <ul className="my-4 ml-6 list-disc space-y-2 text-muted-foreground">
        {children}
      </ul>
    ),
    ol: ({ children }: ChildrenOnly) => (
      <ol className="my-4 ml-6 list-decimal space-y-2 text-muted-foreground">
        {children}
      </ol>
    ),
    li: ({ children }: ChildrenOnly) => (
      <li className="leading-7">{children}</li>
    ),
    blockquote: ({ children }: ChildrenOnly) => (
      <blockquote className="my-6 border-l-2 border-border pl-6 italic text-muted-foreground">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-10 border-border" />,
    code: ({ children }: ChildrenOnly) => (
      <code className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">
        {children}
      </code>
    ),
    strong: ({ children }: ChildrenOnly) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }: ChildrenOnly) => (
      <em className="italic">{children}</em>
    ),
    a: ({ href = '', children }: AnchorMDX) => {
      // Use Next.js Link for in-app anchors so prefetching works.
      if (href.startsWith('/')) {
        return (
          <Link
            href={href}
            className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          >
            {children}
          </Link>
        );
      }
      // External / mailto links go through a plain anchor.
      return (
        <a
          href={href}
          className="font-medium text-foreground underline underline-offset-2 hover:text-primary"
          rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
        >
          {children}
        </a>
      );
    },
    ...components,
  };
}
