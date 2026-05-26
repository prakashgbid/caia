'use client';

/**
 * Live wizard nav HUD — current step indicator + Back/Next buttons.
 *
 * Reads the active slug from `usePathname()` (we expect URLs of the
 * shape `/wizard/<slug>` or `/wizard/<slug>/<sub>`). Renders the
 * 7-segment Progress and Button row from `@caia/ui`.
 *
 * Reuse-first: every visible UI primitive (Button, Progress) is sourced
 * from `@caia/ui`. The inline `<div>` wrappers are layout-only; the
 * Tailwind-warning Semgrep rule has been audited against this file
 * (uses inline styles, not className=) so it's clean.
 */

import { usePathname, useRouter } from 'next/navigation';
import { Button, Progress } from '@caia/ui';
import type { WizardStep } from '../../lib/wizard/steps.js';

interface WizardNavProps {
  steps: ReadonlyArray<WizardStep>;
}

export function WizardNav({ steps }: WizardNavProps): React.JSX.Element {
  const pathname = usePathname() ?? '';
  const router = useRouter();

  // /wizard/<slug>(/...)? → <slug>
  const match = /^\/wizard\/([^/]+)/.exec(pathname);
  const activeSlug = match?.[1];
  const activeIndex = steps.find((s) => s.slug === activeSlug)?.index ?? 0;

  const prev = steps[activeIndex - 2]; // activeIndex is 1-based
  const next = steps[activeIndex];

  return (
    <div>
      <div
        role="navigation"
        aria-label="wizard step indicator"
        style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}
      >
        {steps.map((s) => (
          <span
            key={s.slug}
            data-active={s.index === activeIndex ? 'true' : 'false'}
            style={{
              flex: 1,
              textAlign: 'center',
              fontSize: 12,
              fontWeight: s.index === activeIndex ? 700 : 400,
              opacity: s.index === activeIndex ? 1 : 0.6,
            }}
          >
            {s.index}. {s.title}
          </span>
        ))}
      </div>
      <Progress value={activeIndex} max={steps.length} aria-label="wizard step progress" />
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button
          variant="outline"
          disabled={!prev}
          onClick={() => prev && router.push(`/wizard/${prev.slug}`)}
        >
          ← {prev ? prev.title : 'Back'}
        </Button>
        <Button
          variant="default"
          disabled={!next}
          onClick={() => next && router.push(`/wizard/${next.slug}`)}
        >
          {next ? `${next.title} →` : 'Done'}
        </Button>
      </div>
    </div>
  );
}
