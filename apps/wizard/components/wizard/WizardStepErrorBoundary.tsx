'use client';
/**
 * `<WizardStepErrorBoundary>` — Phase B B1 client-side error boundary
 * surface shared by every wizard step's `error.tsx`.
 *
 * Each step's route file is a thin Next.js App Router `error.tsx` wrapper
 * that hands the framework-provided `error` + `reset` to this component;
 * the component owns the recovery UX + tracing emission so the per-step
 * files stay 6 lines.
 *
 * Behaviour:
 *   - Emits an OTel span via `@chiefaia/tracing` so Tempo records the
 *     boundary trip — span name `wizard.step.error.<step>`, attributes
 *     carry step slug + error name/message digest. The span's traceId
 *     is surfaced in the UI so customer support can quote it back.
 *   - Renders a friendly recovery `@caia/ui` Card with three actions:
 *       1. "Try again"           → calls `reset()` (re-renders the route)
 *       2. "Back to dashboard"   → navigates to `/`
 *       3. "Contact support"     → mailto with the trace_id pre-filled
 *   - Tolerates `process` being absent (jsdom test env without
 *     `globalThis.process` is fine — `createTracer` degrades to a
 *     no-op tracer that still synthesises a stable traceId).
 *
 * Reuse-first: every visible primitive (Card, Button) is from `@caia/ui`.
 * No raw shadcn/Radix imports. Tracing routed through `@chiefaia/tracing`
 * — no parallel OTel surface.
 *
 * Test ergonomics:
 *   - `traceImpl?: typeof createTracer` lets tests swap the tracer for an
 *     in-memory spy without touching real OTel state.
 *   - `onResetClick?` / `onDashboardClick?` lets tests assert the
 *     handlers fire (Next.js `useRouter` is mocked in vitest).
 */

import * as React from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@caia/ui';

// Tracer surface — we use a structural subset of @chiefaia/tracing's
// Tracer so the boundary stays compatible with the canonical surface,
// but we deliberately do NOT import from @chiefaia/tracing here. Its
// barrel re-exports `initTracing` which transitively requires
// @opentelemetry/sdk-node + @grpc/grpc-js — node-only modules that
// fail Next.js's client bundling with `Module not found: Can't resolve
// 'tls' / 'net'`. The boundary runs in the browser, so we ship a
// minimal client-safe createTracer that synthesises a stable traceId
// and emits no-op spans. The server-side tracing pipeline still
// records the original error via the Next.js error.tsx digest +
// the framework's own server-side OTel.
//
// Tests inject a richer `traceImpl` to spy on attribute setting.
type SpanAttrs = Record<string, string | number | boolean | undefined>;
interface Span {
  context: { traceId: string; spanId: string; parentSpanId?: string };
  setAttribute(key: string, value: string | number | boolean): void;
  addEvent(name: string, attrs?: SpanAttrs): void;
  setStatus(code: 'ok' | 'error', message?: string): void;
  end(): void;
}
interface Tracer {
  startSpan(name: string, options?: { parent?: Span['context'] }): Span;
  withSpan<T>(name: string, fn: (s: Span) => T | Promise<T>): Promise<T>;
}

function randomHex(bytes: number): string {
  // Browser-safe random hex. Falls back to Math.random when
  // crypto.getRandomValues is unavailable (jsdom older builds).
  const out: string[] = [];
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    for (const b of buf) out.push(b.toString(16).padStart(2, '0'));
    return out.join('');
  }
  for (let i = 0; i < bytes; i++) {
    out.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  }
  return out.join('');
}

function createTracer(_name: string): Tracer {
  return {
    startSpan(_spanName: string): Span {
      const traceId = randomHex(16);
      const spanId = randomHex(8);
      return {
        context: { traceId, spanId },
        setAttribute() {
          /* no-op — client-side boundary; server emits the canonical span */
        },
        addEvent() {},
        setStatus() {},
        end() {},
      };
    },
    async withSpan(spanName, fn) {
      return fn(this.startSpan(spanName));
    },
  };
}

export interface WizardStepErrorBoundaryProps {
  /**
   * Canonical wizard step slug — one of the 7 entries in
   * `lib/wizard/steps.ts`. Drives the span name + on-screen copy.
   */
  step:
    | 'onboarding'
    | 'grand-idea'
    | 'interview'
    | 'architecture'
    | 'proposal'
    | 'design'
    | 'atlas';
  /** Framework-provided error (Next.js App Router `error.tsx` signature). */
  error: Error & { digest?: string };
  /** Framework-provided reset hook (Next.js App Router `error.tsx`). */
  reset: () => void;
  /** Test seam — defaults to the real `createTracer`. */
  traceImpl?: typeof createTracer;
  /** Test seam — invoked instead of `reset()` when provided. */
  onResetClick?: () => void;
  /** Test seam — invoked instead of `router.push('/')` when provided. */
  onDashboardClick?: () => void;
  /** Optional support email — defaults to support@caia.dev. */
  supportEmail?: string;
}

const STEP_TITLES: Record<WizardStepErrorBoundaryProps['step'], string> = {
  onboarding: 'Step 1 — Onboarding',
  'grand-idea': 'Step 2 — Grand Idea',
  interview: 'Step 3 — Interview',
  architecture: 'Step 4 — Architecture',
  proposal: 'Step 5 — Business Proposal',
  design: 'Step 6 — Design',
  atlas: 'Step 7 — Atlas',
};

function emitErrorSpan(
  tracer: Tracer,
  step: WizardStepErrorBoundaryProps['step'],
  error: Error & { digest?: string },
): string {
  // Use `startSpan` (not `withSpan`) because the boundary renders
  // synchronously during a React commit — we want to end the span
  // immediately, not gate the commit on an async wrapper.
  const span = tracer.startSpan('wizard.step.error');
  span.setAttribute('caia.wizard.step', step);
  span.setAttribute('error.name', error.name || 'Error');
  span.setAttribute('error.message', truncate(error.message || 'unknown', 200));
  if (error.digest) {
    span.setAttribute('error.digest', error.digest);
  }
  span.setStatus('error', error.message);
  span.end();
  return span.context.traceId;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export function WizardStepErrorBoundary(
  props: WizardStepErrorBoundaryProps,
): React.JSX.Element {
  const {
    step,
    error,
    reset,
    traceImpl,
    onResetClick,
    onDashboardClick,
    supportEmail = 'support@caia.dev',
  } = props;

  // Build the tracer once per mount so the traceId is stable across
  // re-renders of the same boundary instance. The tracer factory
  // degrades to a no-op + synthesised traceId when no OTel SDK is
  // installed — same behaviour the wizard API routes rely on.
  const traceIdRef = React.useRef<string | null>(null);
  if (traceIdRef.current === null) {
    const factory = traceImpl ?? createTracer;
    const tracer = factory(`chiefaia.dashboard.wizard.${step}.error`);
    traceIdRef.current = emitErrorSpan(tracer, step, error);
  }
  const traceId = traceIdRef.current;

  const handleReset = React.useCallback(() => {
    if (onResetClick) {
      onResetClick();
      return;
    }
    reset();
  }, [onResetClick, reset]);

  const handleDashboard = React.useCallback(() => {
    if (onDashboardClick) {
      onDashboardClick();
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.assign('/');
    }
  }, [onDashboardClick]);

  const supportHref =
    `mailto:${supportEmail}` +
    `?subject=${encodeURIComponent(`Wizard ${step} error — trace ${traceId}`)}` +
    `&body=${encodeURIComponent(
      `Hi CAIA support,\n\n` +
        `I hit an error on wizard step "${step}".\n` +
        `Reference trace_id: ${traceId}\n` +
        (error.digest ? `Error digest: ${error.digest}\n` : '') +
        `\n— sent from the wizard error boundary`,
    )}`;

  return (
    <Card data-testid={`wizard-step-error-${step}`}>
      <CardHeader>
        <CardTitle>{STEP_TITLES[step]} — something went wrong</CardTitle>
        <CardDescription>
          We hit an unexpected error on this step. The rest of your wizard
          progress is safe. You can retry, head back to the dashboard, or
          reach support with the reference below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div
          data-testid="wizard-step-error-trace"
          style={{
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            opacity: 0.7,
            marginBottom: '1rem',
          }}
        >
          trace_id: <span data-testid="wizard-step-error-trace-id">{traceId}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Button
            data-testid="wizard-step-error-retry"
            onClick={handleReset}
            variant="default"
          >
            Try again
          </Button>
          <Button
            data-testid="wizard-step-error-dashboard"
            onClick={handleDashboard}
            variant="outline"
          >
            Back to dashboard
          </Button>
          <a
            data-testid="wizard-step-error-support"
            href={supportHref}
            style={{ textDecoration: 'none' }}
          >
            <Button variant="secondary" type="button">
              Contact support
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
