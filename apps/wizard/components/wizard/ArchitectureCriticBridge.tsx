'use client';
/**
 * `<ArchitectureCriticBridge>` — client wrapper that conditionally
 * mounts `<CriticFeedbackPanel>` for the IA step (Phase B B6).
 *
 * Why a separate bridge:
 *   - `<CriticFeedbackPanel>` is `'use client'` (it owns selection +
 *     fetch state). The architecture page is a server component.
 *   - The page can't import a client component AND pass it React
 *     callbacks (onRerunSuccess / onDismiss) — those have to live in
 *     a sibling client boundary. The bridge owns the local visibility
 *     state so dismissal hides the panel without a server round-trip.
 *
 * V1 wiring: the bridge builds a stub feedback envelope from
 * compile-time fixtures keyed by `criticKind`. Wave 2 replaces the
 * fixture with the runIA response shape sourced from the run endpoint.
 */

import * as React from 'react';
import {
  CriticFeedbackPanel,
  type CriticFeedback,
  type CriticFeedbackKind,
} from './CriticFeedbackPanel';

export interface ArchitectureCriticBridgeProps {
  projectId: string;
  criticKind: CriticFeedbackKind | null;
  /** Test seam — override the fetch the panel uses for rerun. */
  fetchImpl?: typeof fetch;
}

const STUB_MODIFICATIONS: CriticFeedback['modifications'] = [
  {
    id: 'ia-tighten-page-hierarchy',
    title: 'Tighten the Atlas page hierarchy',
    description:
      'The Atlas page tree is currently 2 levels deep; the critic recommends 3 levels for clearer navigation.',
    severity: 'p2',
    category: 'pages',
  },
  {
    id: 'ia-add-destructive-variant',
    title: 'Add a destructive variant to Button',
    description:
      'The design system is missing the destructive variant the critic flagged as required for delete actions.',
    severity: 'p1',
    category: 'design-system',
  },
];

export function ArchitectureCriticBridge(
  props: ArchitectureCriticBridgeProps,
): React.JSX.Element | null {
  const { projectId, criticKind } = props;
  const [dismissed, setDismissed] = React.useState(false);

  if (!criticKind || dismissed) {
    return null;
  }

  const feedback: CriticFeedback = {
    kind: criticKind,
    step: 'architecture',
    modifications: STUB_MODIFICATIONS,
    rerunEndpoint: '/api/wizard/architecture/run',
    rerunBody: { tenantProjectId: projectId },
  };

  return (
    <CriticFeedbackPanel
      feedback={feedback}
      {...(props.fetchImpl ? { fetchImpl: props.fetchImpl } : {})}
      onDismiss={() => setDismissed(true)}
    />
  );
}
