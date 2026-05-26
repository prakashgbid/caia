/**
 * SiteShell — wraps every marketing-site page with header + footer.
 *
 * Composed from `@caia/ui` primitives. CTAs that are semantically links use
 * `buttonVariants` (also exported from @caia/ui) applied to Next.js <Link>
 * so we don't get nested <a><button> HTML or a click handler hack.
 *
 * The reuse-first doctrine flags inline Tailwind utility classes on
 * customer-facing apps (WARNING). The frame here lives exactly once and is
 * intentionally minimal — anything reusable beyond the frame goes into
 * @caia/ui in its own PR per the doctrine.
 */

import Link from 'next/link';
import { buttonVariants, cn } from '@caia/ui';
import { primaryNav, siteConfig, dashboardUrl } from '../lib/site-config';

export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground antialiased">
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-6xl px-6 py-12">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-foreground"
        >
          {siteConfig.name}
        </Link>
        <nav aria-label="Primary" className="hidden gap-6 text-sm md:flex">
          {primaryNav
            .filter((item) => item.href !== '/')
            .map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
        </nav>
        <div className="flex items-center gap-3">
          <Link
            href="/sign-in"
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            Sign in
          </Link>
          <a
            href={dashboardUrl}
            className={cn(buttonVariants({ size: 'sm' }))}
            rel="noopener noreferrer"
          >
            Open dashboard
          </a>
        </div>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border bg-background">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 text-sm text-muted-foreground">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="text-base font-semibold text-foreground">
              {siteConfig.name}
            </p>
            <p className="mt-2 max-w-xs">{siteConfig.tagline}</p>
          </div>
          <nav aria-label="Footer primary" className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-foreground">
              Product
            </p>
            {primaryNav
              .filter((i) =>
                ['/', '/pricing', '/docs', '/changelog'].includes(i.href)
              )
              .map((i) => (
                <Link key={i.href} href={i.href} className="block hover:text-foreground">
                  {i.label}
                </Link>
              ))}
          </nav>
          <nav aria-label="Footer secondary" className="space-y-2">
            <p className="text-xs uppercase tracking-wide text-foreground">
              Company
            </p>
            <Link href="/blog" className="block hover:text-foreground">
              Blog
            </Link>
            <Link href="/contact" className="block hover:text-foreground">
              Contact
            </Link>
            <Link href="/sign-in" className="block hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
        <p className="mt-10 text-xs">
          &copy; {new Date().getFullYear()} {siteConfig.publisher}. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
