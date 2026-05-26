/**
 * 404 — generic not-found page. Surfaces canonical nav back to /, /docs, /blog.
 */

import Link from 'next/link';
import { buttonVariants, cn } from '@caia/ui';

export default function NotFound() {
  return (
    <div className="space-y-6 py-12 text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        404
      </p>
      <h1 className="text-4xl font-semibold tracking-tight text-foreground">
        We couldn&apos;t find that page
      </h1>
      <p className="mx-auto max-w-md text-muted-foreground">
        It may have moved, been renamed, or never existed. Try one of the canonical
        routes below.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className={cn(buttonVariants())}>
          Home
        </Link>
        <Link href="/docs" className={cn(buttonVariants({ variant: 'outline' }))}>
          Docs
        </Link>
        <Link href="/blog" className={cn(buttonVariants({ variant: 'ghost' }))}>
          Blog
        </Link>
      </div>
    </div>
  );
}
