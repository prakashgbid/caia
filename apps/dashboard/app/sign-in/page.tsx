'use client';
/**
 * `/sign-in` — Cloudflare Access redirect-target stub.
 *
 * Cloudflare Access intercepts requests *before* they reach Next.js. The
 * actual sign-in UI is rendered by CF — this page only exists for two
 * reasons:
 *
 *   1. Middleware redirects here when there's no `CF_Authorization`
 *      cookie. CF's edge will see the path is in the protected
 *      Application and pop its own sign-in flow. After auth it sets the
 *      cookie and forwards the request back to this page; we then bounce
 *      to `from` (or `/`).
 *
 *   2. If a user somehow lands here without CF in front (eg local dev
 *      with `CF_ACCESS_TEAM_DOMAIN` unset), we render an explanatory Card
 *      so the experience isn't a blank screen.
 *
 * UI primitives strictly from `@caia/ui` per reuse-first.
 */

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@caia/ui';

interface PageProps {
  searchParams?: Promise<{ from?: string; r?: string }>;
}

export default async function SignInPage({ searchParams }: PageProps) {
  const params = searchParams ? await Promise.resolve(searchParams) : {};
  const from = params.from ?? '/';
  const reason = params.r;

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f1117',
        color: '#f0f4f8',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 480 }}>
        <Card data-testid="sign-in-card">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>
              CAIA uses Cloudflare Access. If you have access to the team
              domain you'll be authenticated automatically.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p style={{ marginBottom: 12 }}>
              {reason === 'invalid-jwt'
                ? 'Your previous session is no longer valid. Sign in to continue.'
                : reason === 'no-email-claim'
                ? 'Your identity provider did not return an email — contact an admin.'
                : 'Please sign in to continue.'}
            </p>
            <form method="get" action={from}>
              <Button type="submit" variant="default" data-testid="sign-in-continue">
                Continue
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
