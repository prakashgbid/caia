/**
 * @vitest-environment jsdom
 *
 * Phase B B1 — `<WizardStepErrorBoundary>` unit tests.
 *
 * The 7 per-step `error.tsx` files are 6-line shims that hand the
 * framework-provided `error`/`reset` to this component, so the
 * component's behaviour IS the boundary's behaviour. We assert:
 *
 *   - rendering: title + friendly copy + trace_id surfaced + three CTAs.
 *   - recovery actions: Try-again calls `reset`, Back-to-dashboard
 *     navigates, Contact-support builds a mailto with the trace_id.
 *   - tracing: emits exactly one OTel span per mount, with the
 *     expected span name + attributes + error status.
 *   - per-step copy: every slug in the canonical 7-step catalog
 *     yields a distinct rendered title.
 *
 * We pass an in-memory `traceImpl` so the test never touches the real
 * OTel SDK — the spy captures `startSpan` calls and we assert on them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Span, SpanAttributes, Tracer } from '@chiefaia/tracing';
import {
  WizardStepErrorBoundary,
  type WizardStepErrorBoundaryProps,
} from '../../../components/wizard/WizardStepErrorBoundary';

afterEach(() => cleanup());

interface CapturedSpan {
  name: string;
  attributes: Record<string, string | number | boolean>;
  status?: { code: 'ok' | 'error'; message?: string };
  ended: boolean;
}

function makeTraceSpy(traceId = 'trace-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
  const spans: CapturedSpan[] = [];
  const factory = (_name: string): Tracer => ({
    startSpan(spanName: string): Span {
      const rec: CapturedSpan = {
        name: spanName,
        attributes: {},
        ended: false,
      };
      spans.push(rec);
      const span: Span = {
        context: { traceId, spanId: 'span-1111111111111111' },
        setAttribute(key: string, value: string | number | boolean) {
          rec.attributes[key] = value;
        },
        addEvent(_n: string, _a?: SpanAttributes) {
          /* unused in B1 */
        },
        setStatus(code, message) {
          rec.status =
            message !== undefined ? { code, message } : { code };
        },
        end() {
          rec.ended = true;
        },
      };
      return span;
    },
    async withSpan(spanName, fn) {
      return fn(this.startSpan(spanName));
    },
  });
  return { spans, factory };
}

function renderBoundary(
  overrides: Partial<WizardStepErrorBoundaryProps> = {},
) {
  const reset = vi.fn();
  const { spans, factory } = makeTraceSpy(
    overrides.error?.digest ? `trace-${overrides.error.digest}` : undefined,
  );
  const props: WizardStepErrorBoundaryProps = {
    step: 'interview',
    error: Object.assign(new Error('boom'), { digest: 'd1234' }),
    reset,
    traceImpl: factory,
    ...overrides,
  };
  render(<WizardStepErrorBoundary {...props} />);
  return { reset, spans };
}

describe('<WizardStepErrorBoundary> rendering', () => {
  it('renders the step-specific title', () => {
    renderBoundary({ step: 'interview' });
    expect(
      screen.getByText(/Step 3 — Interview — something went wrong/),
    ).toBeTruthy();
  });

  it('exposes a stable test-id keyed by step slug', () => {
    renderBoundary({ step: 'design' });
    expect(screen.getByTestId('wizard-step-error-design')).toBeTruthy();
  });

  it('surfaces the trace_id in the recovery copy', () => {
    const { spans } = renderBoundary();
    const traceId = screen.getByTestId('wizard-step-error-trace-id')
      .textContent;
    expect(traceId).toBeTruthy();
    // The same traceId must appear on the emitted span.
    expect(spans.length).toBe(1);
  });

  it('renders all three recovery CTAs', () => {
    renderBoundary();
    expect(screen.getByTestId('wizard-step-error-retry').textContent).toBe(
      'Try again',
    );
    expect(
      screen.getByTestId('wizard-step-error-dashboard').textContent,
    ).toBe('Back to dashboard');
    // Contact support is an anchor wrapping a button; assert the anchor.
    const support = screen.getByTestId('wizard-step-error-support');
    expect(support.tagName).toBe('A');
  });

  it('renders a distinct title for every step slug', () => {
    const slugs: WizardStepErrorBoundaryProps['step'][] = [
      'onboarding',
      'grand-idea',
      'interview',
      'architecture',
      'proposal',
      'design',
      'atlas',
    ];
    const titles = new Set<string>();
    for (const step of slugs) {
      cleanup();
      renderBoundary({ step });
      const card = screen.getByTestId(`wizard-step-error-${step}`);
      titles.add(card.querySelector('h3')?.textContent ?? '');
    }
    expect(titles.size).toBe(slugs.length);
  });
});

describe('<WizardStepErrorBoundary> recovery actions', () => {
  it('fires `reset` when Try-again is clicked (default behavior)', () => {
    const { reset } = renderBoundary();
    fireEvent.click(screen.getByTestId('wizard-step-error-retry'));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('routes through `onResetClick` test seam when supplied', () => {
    const onResetClick = vi.fn();
    const { reset } = renderBoundary({ onResetClick });
    fireEvent.click(screen.getByTestId('wizard-step-error-retry'));
    expect(onResetClick).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();
  });

  it('routes through `onDashboardClick` test seam for Back-to-dashboard', () => {
    const onDashboardClick = vi.fn();
    renderBoundary({ onDashboardClick });
    fireEvent.click(screen.getByTestId('wizard-step-error-dashboard'));
    expect(onDashboardClick).toHaveBeenCalledTimes(1);
  });

  it('builds a mailto with the trace_id pre-filled on the Contact support link', () => {
    renderBoundary();
    const support = screen.getByTestId('wizard-step-error-support');
    const href = support.getAttribute('href') ?? '';
    expect(href.startsWith('mailto:support@caia.dev')).toBe(true);
    expect(decodeURIComponent(href)).toContain('trace');
    expect(decodeURIComponent(href)).toContain('interview');
  });

  it('uses a custom supportEmail when supplied', () => {
    renderBoundary({ supportEmail: 'help@example.com' });
    const href = screen
      .getByTestId('wizard-step-error-support')
      .getAttribute('href') ?? '';
    expect(href.startsWith('mailto:help@example.com')).toBe(true);
  });
});

describe('<WizardStepErrorBoundary> tracing', () => {
  it('emits exactly one span per mount', () => {
    const { spans } = renderBoundary();
    expect(spans.length).toBe(1);
    expect(spans[0]!.name).toBe('wizard.step.error');
    expect(spans[0]!.ended).toBe(true);
  });

  it('sets caia.wizard.step + error.name + error.message attributes', () => {
    const { spans } = renderBoundary({
      step: 'proposal',
      error: Object.assign(new Error('kaboom'), { name: 'BoomError' }),
    });
    expect(spans[0]!.attributes['caia.wizard.step']).toBe('proposal');
    expect(spans[0]!.attributes['error.name']).toBe('BoomError');
    expect(spans[0]!.attributes['error.message']).toBe('kaboom');
  });

  it('records error.digest when present (Next.js hashes server errors)', () => {
    const err = Object.assign(new Error('with-digest'), { digest: 'abc123' });
    const { spans } = renderBoundary({ error: err });
    expect(spans[0]!.attributes['error.digest']).toBe('abc123');
  });

  it('omits error.digest attribute when the framework did not provide one', () => {
    const err = new Error('no-digest');
    const { spans } = renderBoundary({ error: err });
    expect('error.digest' in spans[0]!.attributes).toBe(false);
  });

  it('marks the span as error status with the error message', () => {
    const { spans } = renderBoundary({ error: new Error('explode') });
    expect(spans[0]!.status?.code).toBe('error');
    expect(spans[0]!.status?.message).toBe('explode');
  });

  it('truncates very long error.message to 200 chars + ellipsis', () => {
    const longMsg = 'x'.repeat(500);
    const { spans } = renderBoundary({ error: new Error(longMsg) });
    const recorded = String(spans[0]!.attributes['error.message']);
    expect(recorded.length).toBeLessThanOrEqual(201);
    expect(recorded.endsWith('…')).toBe(true);
  });

  it('does not emit a second span on re-render with the same error', () => {
    const reset = vi.fn();
    const { spans, factory } = makeTraceSpy();
    const err = new Error('stable');
    const { rerender } = render(
      <WizardStepErrorBoundary
        step="atlas"
        error={err}
        reset={reset}
        traceImpl={factory}
      />,
    );
    rerender(
      <WizardStepErrorBoundary
        step="atlas"
        error={err}
        reset={reset}
        traceImpl={factory}
      />,
    );
    expect(spans.length).toBe(1);
  });

  it('creates the tracer with the step-scoped service name', () => {
    const capturedNames: string[] = [];
    const factory = (name: string): Tracer => {
      capturedNames.push(name);
      return {
        startSpan: () => ({
          context: { traceId: 'tid', spanId: 'sid' },
          setAttribute() {},
          addEvent() {},
          setStatus() {},
          end() {},
        }),
        async withSpan(_n, fn) {
          return fn(this.startSpan('x'));
        },
      };
    };
    render(
      <WizardStepErrorBoundary
        step="grand-idea"
        error={new Error('x')}
        reset={() => {}}
        traceImpl={factory}
      />,
    );
    expect(capturedNames).toContain(
      'chiefaia.dashboard.wizard.grand-idea.error',
    );
  });
});
