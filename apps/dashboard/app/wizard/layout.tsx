/**
 * Shared wizard layout — Card frame + 7-step Progress indicator +
 * Back/Next buttons. UI primitives are SOURCED EXCLUSIVELY FROM `@caia/ui`
 * per ADR-061 / ADR-065 (reuse-first).
 *
 * This layout is intentionally a server component (no `'use client'`):
 *   - It does not subscribe to wizard state in the layout itself; the
 *     individual step pages and a `'use client'` HUD subcomponent do.
 *   - Keeps the bundle small for the initial render.
 *
 * The current step is derived from the URL slug (`/wizard/<slug>/...`),
 * read via the `params` prop forwarded from Next.js. When the snapshot
 * disagrees with the URL (eg user navigated back), the layout still shows
 * the URL-based step — the snapshot is for *the project*, the URL is for
 * *what the user is looking at*.
 */

import { Card, CardContent, CardHeader, CardTitle, Progress } from '@caia/ui';
import { findStepBySlug, WIZARD_STEPS } from '../../lib/wizard/steps.js';
import { WizardNav } from '../../components/wizard/WizardNav';

export default function WizardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The current slug is derived inside child pages and propagated upward
  // via Next.js's nested layouts. Since the layout file does not have
  // direct access to params here, we render a passive shell and let the
  // `WizardNav` client component read the slug from `usePathname()`.
  return (
    <div
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: 24,
        color: '#f0f4f8',
        background: '#0f1117',
        minHeight: '100vh',
      }}
    >
      <Card>
        <CardHeader>
          <CardTitle>CAIA Wizard</CardTitle>
        </CardHeader>
        <CardContent>
          <WizardNav steps={WIZARD_STEPS} />
          <ProgressShell stepCount={WIZARD_STEPS.length} />
          <div style={{ marginTop: 24 }}>{children}</div>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Server-rendered Progress placeholder — shows the 7-segment bar at 0%.
 * The hydrated `WizardNav` overrides it with the live percentage based
 * on the current slug. Two-pass render avoids hydration mismatch.
 */
function ProgressShell({ stepCount }: { stepCount: number }): React.JSX.Element {
  return (
    <div style={{ marginTop: 16 }} aria-label="wizard progress shell">
      <Progress value={0} max={stepCount} />
    </div>
  );
}

export { findStepBySlug };
