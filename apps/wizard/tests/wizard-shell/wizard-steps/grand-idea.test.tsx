/**
 * @vitest-environment jsdom
 *
 * Unit tests for the Step 2 grand-idea wizard page bridge.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GrandIdeaStepBridge } from '../../../components/wizard/GrandIdeaStepBridge';

afterEach(() => cleanup());

function makeFetchSpy(
  pathToResponse: (url: string) => Response | Promise<Response>,
): typeof fetch {
  const spy = vi.fn(async (url: unknown) =>
    pathToResponse(typeof url === 'string' ? url : String(url)),
  );
  return spy as unknown as typeof fetch;
}

describe('<GrandIdeaStepBridge>', () => {
  it('renders the underlying GrandIdeaForm', () => {
    render(<GrandIdeaStepBridge projectId="p-1" tenantSlug="t-1" />);
    expect(screen.getByTestId('grand-idea-step-bridge')).toBeTruthy();
    expect(screen.getByTestId('grand-idea-form')).toBeTruthy();
  });

  it('exposes the textarea for the founder prompt', () => {
    render(<GrandIdeaStepBridge projectId="p-1" tenantSlug="t-1" />);
    expect(screen.getByTestId('grand-idea-prompt')).toBeTruthy();
  });

  it('shows a too-short error when the prompt is below the word floor', () => {
    render(<GrandIdeaStepBridge projectId="p-1" tenantSlug="t-1" />);
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), {
      target: { value: 'too short' },
    });
    expect(screen.getByTestId('word-count-error').textContent).toContain('At least');
  });

  it('shows a word count', () => {
    render(<GrandIdeaStepBridge projectId="p-1" tenantSlug="t-1" />);
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), {
      target: { value: 'hello world this is a test' },
    });
    expect(screen.getByTestId('word-count').textContent).toBe('6 words');
  });

  it('disables submit when the prompt is too short', () => {
    render(<GrandIdeaStepBridge projectId="p-1" tenantSlug="t-1" />);
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), {
      target: { value: 'too short' },
    });
    const submit = screen.getByTestId('submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('posts to /api/grand-idea on submit', async () => {
    const fetchSpy = makeFetchSpy((url) => {
      if (url.endsWith('/api/grand-idea')) {
        return new Response(JSON.stringify({ ok: true, revisionNumber: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ state: 'idea-captured' }), { status: 200 });
    });
    render(
      <GrandIdeaStepBridge
        projectId="p-7"
        tenantSlug="t-7"
        fetchImpl={fetchSpy}
      />,
    );
    const prompt =
      'CAIA is a customer-facing wizard that captures the founder\'s grand idea and walks them through the onboarding flow. It captures every step and produces a business proposal at the end. The product is monetized via subscription.';
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), { target: { value: prompt } });
    fireEvent.click(screen.getByTestId('submit'));
    await new Promise((r) => setTimeout(r, 20));
    expect((fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      '/api/grand-idea',
    );
  });

  it('dispatches PATCH to /api/wizard/<project>/state after capture', async () => {
    const calls: string[] = [];
    const fetchSpy = makeFetchSpy((url) => {
      calls.push(url);
      if (url.endsWith('/api/grand-idea')) {
        return new Response(JSON.stringify({ ok: true, revisionNumber: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ state: 'idea-captured' }), { status: 200 });
    });
    render(
      <GrandIdeaStepBridge projectId="p-9" tenantSlug="t-9" fetchImpl={fetchSpy} />,
    );
    const prompt =
      'CAIA is a customer-facing wizard. The wizard captures the founder grand idea and progresses through onboarding and interview steps before producing the proposal.';
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), { target: { value: prompt } });
    fireEvent.click(screen.getByTestId('submit'));
    await new Promise((r) => setTimeout(r, 40));
    expect(calls.some((u) => u === '/api/wizard/p-9/state')).toBe(true);
  });

  it('handles a 409 from the FSM as already-captured', async () => {
    const fetchSpy = makeFetchSpy((url) => {
      if (url.endsWith('/api/grand-idea')) {
        return new Response(JSON.stringify({ ok: true, revisionNumber: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'invalid-transition' }), { status: 409 });
    });
    let advancedInfo: { applied: boolean; alreadyCaptured: boolean } | null = null;
    render(
      <GrandIdeaStepBridge
        projectId="p-10"
        tenantSlug="t-10"
        fetchImpl={fetchSpy}
        onAdvanced={(i) => (advancedInfo = i)}
      />,
    );
    const prompt = 'CAIA wizard captures the founder grand idea and walks them through every step of the onboarding pipeline and produces an actionable proposal.';
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), { target: { value: prompt } });
    fireEvent.click(screen.getByTestId('submit'));
    await new Promise((r) => setTimeout(r, 40));
    expect(advancedInfo).toEqual({ applied: false, alreadyCaptured: true });
    expect(screen.getByTestId('advance-already')).toBeTruthy();
  });

  it('renders the success message when the FSM advance succeeds', async () => {
    const fetchSpy = makeFetchSpy((url) => {
      if (url.endsWith('/api/grand-idea')) {
        return new Response(JSON.stringify({ ok: true, revisionNumber: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ state: 'idea-captured' }), { status: 200 });
    });
    render(<GrandIdeaStepBridge projectId="p-11" tenantSlug="t-11" fetchImpl={fetchSpy} />);
    const prompt = 'CAIA wizard captures the founder grand idea and walks them through every step of the onboarding pipeline and produces an actionable proposal.';
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), { target: { value: prompt } });
    fireEvent.click(screen.getByTestId('submit'));
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.getByTestId('advance-success')).toBeTruthy();
  });

  it('surfaces an error when the FSM PATCH returns a non-409 failure', async () => {
    const fetchSpy = makeFetchSpy((url) => {
      if (url.endsWith('/api/grand-idea')) {
        return new Response(JSON.stringify({ ok: true, revisionNumber: 1 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
    });
    render(<GrandIdeaStepBridge projectId="p-12" tenantSlug="t-12" fetchImpl={fetchSpy} />);
    const prompt = 'CAIA wizard captures the founder grand idea and walks them through every step of the onboarding pipeline and produces an actionable proposal.';
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), { target: { value: prompt } });
    fireEvent.click(screen.getByTestId('submit'));
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.getByTestId('advance-error').textContent).toContain('boom');
  });

  it('does NOT advance the FSM when the capture call itself fails', async () => {
    const calls: string[] = [];
    const fetchSpy = makeFetchSpy((url) => {
      calls.push(url);
      if (url.endsWith('/api/grand-idea')) {
        return new Response(JSON.stringify({ ok: false, message: 'capture failed' }), {
          status: 400,
        });
      }
      return new Response(JSON.stringify({ state: 'idea-captured' }), { status: 200 });
    });
    render(<GrandIdeaStepBridge projectId="p-13" tenantSlug="t-13" fetchImpl={fetchSpy} />);
    const prompt = 'CAIA wizard captures the founder grand idea and walks them through every step of the onboarding pipeline and produces an actionable proposal.';
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), { target: { value: prompt } });
    fireEvent.click(screen.getByTestId('submit'));
    await new Promise((r) => setTimeout(r, 40));
    expect(calls.filter((u) => u.includes('/api/wizard/'))).toEqual([]);
  });

  it('shows the error from the underlying form when the capture is rejected', async () => {
    const fetchSpy = makeFetchSpy(
      async () =>
        new Response(JSON.stringify({ ok: false, message: 'too short' }), { status: 400 }),
    );
    render(<GrandIdeaStepBridge projectId="p-14" tenantSlug="t-14" fetchImpl={fetchSpy} />);
    const prompt = 'CAIA wizard captures the founder grand idea and walks them through every step of the onboarding pipeline and produces an actionable proposal.';
    fireEvent.change(screen.getByTestId('grand-idea-prompt'), { target: { value: prompt } });
    fireEvent.click(screen.getByTestId('submit'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('result-err').textContent).toContain('too short');
  });
});
