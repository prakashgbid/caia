'use client';
/**
 * `<InterviewCriticBridge>` — client wrapper that conditionally
 * mounts `<CriticFeedbackPanel>` for the Interview step (Phase B B6).
 *
 * Mirrors `<ArchitectureCriticBridge>` for the IA step. The bridge
 * owns the local dismissal state so the panel can hide without a
 * server round-trip.
 *
 * V1 wiring uses compile-time fixtures keyed by `criticKind`. Wave 2
 * sources the under-covered pillars from the live critic response
 * shape returned by `/api/wizard/interview/complete` (which already
 * returns a 412 with coverage diagnostics when the critic verdict is
 * `coverage-insufficient` — see existing route).
 */

import * as React from 'react';
import {
  CriticFeedbackPanel,
  type CriticFeedback,
  type CriticFeedbackKind,
} from './CriticFeedbackPanel';

export interface InterviewCriticBridgeProps {
  projectId: string;
  criticKind: CriticFeedbackKind | null;
  /** Test seam — override the fetch the panel uses for rerun. */
  fetchImpl?: typeof fetch;
}

const STUB_MODIFICATIONS: CriticFeedback['modifications'] = [
  {
    id: 'pillar-target-customer',
    title: 'Add more detail on the target customer',
    description:
      'The critic flagged the target-customer pillar as under-covered. Re-engage the interviewer with a sharper persona description.',
    severity: 'p1',
    category: 'target-customer',
  },
  {
    id: 'pillar-go-to-market',
    title: 'Expand the go-to-market motion',
    description:
      'Coverage on the GTM pillar is thin. The critic wants at least one concrete distribution channel called out.',
    severity: 'p2',
    category: 'go-to-market',
  },
];

export function InterviewCriticBridge(
  props: InterviewCriticBridgeProps,
): React.JSX.Element | null {
  const { projectId, criticKind } = props;
  const [dismissed, setDismissed] = React.useState(false);

  if (!criticKind || dismissed) {
    return null;
  }

  const feedback: CriticFeedback = {
    kind: criticKind,
    step: 'interview',
    modifications: STUB_MODIFICATIONS,
    rerunEndpoint: '/api/wizard/interview/complete',
    rerunBody: { projectId },
  };

  return (
    <CriticFeedbackPanel
      feedback={feedback}
      {...(props.fetchImpl ? { fetchImpl: props.fetchImpl } : {})}
      onDismiss={() => setDismissed(true)}
    />
  );
}
