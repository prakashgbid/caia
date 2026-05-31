'use client';
/**
 * `<CriticFeedbackPanel>` — Phase B B6.
 *
 * Inline modification surface for the IA + Interview steps.
 *
 * Triggered when:
 *   - `runIA` returns `status: 'approved-with-modifications'` (Step 4
 *     architecture) — the panel mounts under the architecture page and
 *     lists the modifications the critic flagged so the user can review
 *     them and "Apply & rerun".
 *   - The Interviewer's critic returns `status: 'coverage-insufficient'`
 *     (Step 3 interview) — the panel mounts under the interview page and
 *     surfaces the pillars that are missing, with the same Apply-and-rerun
 *     CTA.
 *
 * The panel is intentionally a pure presentation + side-effect component.
 * The caller hands it the feedback envelope (sourced from the run-endpoint
 * response) and the URL to POST back to. The panel:
 *   - renders an Accordion of modification items (Card + Badge inside).
 *   - exposes a primary "Apply & rerun" button that POSTs the chosen
 *     modifications back to the run endpoint with `applyModifications: [...]`.
 *   - exposes a secondary "Dismiss" button that calls `onDismiss` so the
 *     parent can hide the panel without rerunning.
 *   - shows a loading state while the rerun is in flight.
 *
 * Reuse-first: every visible primitive (Accordion, Card, Badge, Button)
 * comes from `@caia/ui`. No raw shadcn/Radix imports. The fetch surface
 * is injectable via `fetchImpl` so unit tests never hit a real network.
 */

import * as React from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@caia/ui';

/** Severity tier — mirrors the p0..p3 taxonomy used elsewhere in CAIA. */
export type CriticModificationSeverity = 'p0' | 'p1' | 'p2' | 'p3';

export interface CriticModification {
  /** Stable id the rerun endpoint reads back. */
  id: string;
  /** Short title rendered in the accordion trigger. */
  title: string;
  /** Long-form description rendered in the accordion content. */
  description: string;
  /** Optional severity rendered as a `@caia/ui` Badge variant. */
  severity?: CriticModificationSeverity;
  /** Optional tag (e.g. pillar id for the interview-critic case). */
  category?: string;
}

export type CriticFeedbackKind =
  | 'approved-with-modifications'
  | 'coverage-insufficient';

export interface CriticFeedback {
  /** What kind of critic feedback this is — drives the rendered copy. */
  kind: CriticFeedbackKind;
  /** Which wizard step the feedback belongs to. Drives the header copy. */
  step: 'architecture' | 'interview';
  /** Modification items the critic flagged. */
  modifications: ReadonlyArray<CriticModification>;
  /** URL the Apply-and-rerun button POSTs to. */
  rerunEndpoint: string;
  /** Optional extra body fields passed alongside `applyModifications`. */
  rerunBody?: Record<string, unknown>;
}

export interface CriticFeedbackPanelProps {
  feedback: CriticFeedback;
  /** Fires after a successful rerun POST. Receives the parsed response body. */
  onRerunSuccess?: (responseBody: unknown) => void;
  /** Fires when the user clicks Dismiss. The parent owns hiding. */
  onDismiss?: () => void;
  /** Test seam — defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const SEVERITY_VARIANT: Record<
  CriticModificationSeverity,
  'destructive' | 'default' | 'secondary' | 'outline'
> = {
  p0: 'destructive',
  p1: 'destructive',
  p2: 'default',
  p3: 'secondary',
};

const KIND_TITLE: Record<CriticFeedbackKind, string> = {
  'approved-with-modifications': 'Critic suggests refinements',
  'coverage-insufficient': 'Critic wants more coverage',
};

const KIND_DESCRIPTION: Record<CriticFeedbackKind, string> = {
  'approved-with-modifications':
    'The IA critic approved the design with a few refinement suggestions. Review them below and rerun the step with the ones you want to apply.',
  'coverage-insufficient':
    'The interview critic flagged some pillars as under-covered. Pick the ones you want to address and rerun the interview.',
};

const STEP_LABEL: Record<CriticFeedbackPanelProps['feedback']['step'], string> = {
  architecture: 'Step 4 — Architecture',
  interview: 'Step 3 — Interview',
};

export function CriticFeedbackPanel(
  props: CriticFeedbackPanelProps,
): React.JSX.Element {
  const { feedback, onRerunSuccess, onDismiss } = props;
  const fetchFn =
    props.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(feedback.modifications.map((m) => m.id)),
  );
  const [busy, setBusy] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const toggle = React.useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRerun = React.useCallback(async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetchFn(feedback.rerunEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(feedback.rerunBody ?? {}),
          applyModifications: Array.from(selected),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const responseBody = (await res.json().catch(() => null)) as unknown;
      onRerunSuccess?.(responseBody);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [fetchFn, feedback.rerunEndpoint, feedback.rerunBody, onRerunSuccess, selected]);

  const handleDismiss = React.useCallback(() => {
    onDismiss?.();
  }, [onDismiss]);

  return (
    <Card data-testid={`critic-feedback-${feedback.step}`}>
      <CardHeader>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <CardTitle>{KIND_TITLE[feedback.kind]}</CardTitle>
          <Badge variant="outline" data-testid="critic-feedback-step">
            {STEP_LABEL[feedback.step]}
          </Badge>
        </div>
        <CardDescription>{KIND_DESCRIPTION[feedback.kind]}</CardDescription>
      </CardHeader>
      <CardContent>
        {feedback.modifications.length === 0 ? (
          <p data-testid="critic-feedback-empty" style={{ opacity: 0.7 }}>
            No specific modifications were flagged — you can rerun if you want
            a fresh pass, or dismiss to keep the current result.
          </p>
        ) : (
          <Accordion type="multiple" data-testid="critic-feedback-accordion">
            {feedback.modifications.map((m) => (
              <AccordionItem
                key={m.id}
                value={m.id}
                data-testid={`critic-modification-${m.id}`}
              >
                <AccordionTrigger data-testid={`critic-modification-trigger-${m.id}`}>
                  <span style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      onClick={(e) => e.stopPropagation()}
                      data-testid={`critic-modification-checkbox-${m.id}`}
                      aria-label={`Apply modification ${m.id}`}
                    />
                    {m.severity && (
                      <Badge
                        variant={SEVERITY_VARIANT[m.severity]}
                        data-testid={`critic-modification-severity-${m.id}`}
                      >
                        {m.severity}
                      </Badge>
                    )}
                    {m.category && (
                      <Badge
                        variant="outline"
                        data-testid={`critic-modification-category-${m.id}`}
                      >
                        {m.category}
                      </Badge>
                    )}
                    <span>{m.title}</span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <p
                    data-testid={`critic-modification-desc-${m.id}`}
                    style={{ marginTop: 4, opacity: 0.85 }}
                  >
                    {m.description}
                  </p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            marginTop: '1rem',
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <Button
            data-testid="critic-feedback-rerun"
            onClick={handleRerun}
            disabled={busy}
            variant="default"
          >
            {busy ? 'Rerunning…' : 'Apply & rerun'}
          </Button>
          <Button
            data-testid="critic-feedback-dismiss"
            onClick={handleDismiss}
            disabled={busy}
            variant="ghost"
          >
            Dismiss
          </Button>
          {errorMsg && (
            <span
              data-testid="critic-feedback-error"
              style={{ color: '#b91c1c', fontSize: 13 }}
            >
              {errorMsg}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
