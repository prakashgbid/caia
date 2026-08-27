/**
 * @vitest-environment jsdom
 *
 * Unit tests for <InterviewerChat>. Drives the multi-turn Q&A surface
 * with a mocked fetch — verifies it kicks off the thread on mount,
 * surfaces the first question, posts answers, advances on threshold,
 * and offers an operator-force override on 412.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InterviewerChat } from '../../../components/wizard/InterviewerChat';

afterEach(() => cleanup());

function fakeEnvelope(opts: {
  turn: number;
  text?: string;
  aggregate?: number;
  meets?: boolean;
  exhausted?: boolean;
  nextQuestion?: { id: string; pillar: string; text: string; rationale: string } | null;
}) {
  return {
    ok: true,
    threadId: 't-1',
    turn: opts.turn,
    nextQuestion:
      opts.nextQuestion === undefined
        ? {
            id: `Q-${opts.turn}`,
            pillar: 'B1',
            text: opts.text ?? `Question ${opts.turn}?`,
            rationale: 'why we ask',
          }
        : opts.nextQuestion,
    aggregateScore: opts.aggregate ?? 0,
    meetsThreshold: opts.meets ?? false,
    exhausted: opts.exhausted ?? false,
    pillarCoverage: { B1: { score: opts.aggregate ?? 0, hits: 1, lastTouchedTurn: opts.turn } },
    source: 'memory',
  };
}

function makeFetch(handlers: ReadonlyArray<(url: string, init?: RequestInit) => Response | Promise<Response>>): typeof fetch {
  let i = 0;
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const h = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    return h(typeof url === 'string' ? url : String(url), init);
  });
  return fn as unknown as typeof fetch;
}

describe('<InterviewerChat>', () => {
  it('renders the wizard step card', async () => {
    const fetchSpy = makeFetch([
      () => new Response(JSON.stringify(fakeEnvelope({ turn: 1, text: 'First?' })), { status: 200 }),
    ]);
    await act(async () => {
      render(<InterviewerChat projectId="p-1" fetchImpl={fetchSpy} />);
    });
    expect(screen.getByTestId('wizard-step-interview')).toBeTruthy();
  });

  it('kicks off the thread on first mount (POST with no response)', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchSpy = makeFetch([
      (url, init) => {
        calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return new Response(
          JSON.stringify(fakeEnvelope({ turn: 1, text: 'First?' })),
          { status: 200 },
        );
      },
    ]);
    await act(async () => {
      render(<InterviewerChat projectId="p-2" fetchImpl={fetchSpy} />);
    });
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1));
    expect(calls[0]?.url).toBe('/api/wizard/interview/answer');
    expect(calls[0]?.body).toEqual({ projectId: 'p-2' });
  });

  it('renders the first agent question after start', async () => {
    const fetchSpy = makeFetch([
      () =>
        new Response(JSON.stringify(fakeEnvelope({ turn: 1, text: 'What is the product?' })), {
          status: 200,
        }),
    ]);
    await act(async () => {
      render(<InterviewerChat projectId="p-3" fetchImpl={fetchSpy} />);
    });
    await waitFor(() => expect(screen.queryByTestId('history-agent-1')).toBeTruthy());
    expect(screen.getByTestId('history-agent-1').textContent).toContain('What is the product?');
  });

  it('disables submit when the draft is empty', async () => {
    const fetchSpy = makeFetch([
      () => new Response(JSON.stringify(fakeEnvelope({ turn: 1 })), { status: 200 }),
    ]);
    await act(async () => {
      render(<InterviewerChat projectId="p-4" fetchImpl={fetchSpy} />);
    });
    await waitFor(() => expect(screen.queryByTestId('interview-submit')).toBeTruthy());
    const submit = screen.getByTestId('interview-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('posts the typed answer and renders the next question', async () => {
    const calls: Array<{ url: string; body?: unknown }> = [];
    const fetchSpy = makeFetch([
      (url, init) => {
        calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return new Response(
          JSON.stringify(fakeEnvelope({ turn: 1, text: 'Q1?' })),
          { status: 200 },
        );
      },
      (url, init) => {
        calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined });
        return new Response(
          JSON.stringify(fakeEnvelope({ turn: 2, text: 'Q2?', aggregate: 30 })),
          { status: 200 },
        );
      },
    ]);
    await act(async () => {
      render(<InterviewerChat projectId="p-5" fetchImpl={fetchSpy} />);
    });
    await waitFor(() => expect(screen.queryByTestId('interview-draft-input')).toBeTruthy());
    fireEvent.change(screen.getByTestId('interview-draft-input'), {
      target: { value: 'My answer to Q1.' },
    });
    fireEvent.click(screen.getByTestId('interview-submit'));
    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[1]?.body).toEqual({ projectId: 'p-5', response: 'My answer to Q1.' });
    await waitFor(() =>
      expect(screen.getByTestId('interview-aggregate-score').textContent).toContain('30'),
    );
  });

  it('shows the "ready to advance" badge when meetsThreshold is true', async () => {
    const fetchSpy = makeFetch([
      () =>
        new Response(
          JSON.stringify(fakeEnvelope({ turn: 1, aggregate: 82, meets: true })),
          { status: 200 },
        ),
    ]);
    await act(async () => {
      render(<InterviewerChat projectId="p-6" fetchImpl={fetchSpy} />);
    });
    await waitFor(() => expect(screen.queryByTestId('interview-meets-threshold')).toBeTruthy());
    expect(screen.getByTestId('interview-complete')).toBeTruthy();
  });

  it('shows the exhausted badge when bank is empty', async () => {
    const fetchSpy = makeFetch([
      () =>
        new Response(
          JSON.stringify(fakeEnvelope({ turn: 1, exhausted: true, nextQuestion: null })),
          { status: 200 },
        ),
    ]);
    await act(async () => {
      render(<InterviewerChat projectId="p-7" fetchImpl={fetchSpy} />);
    });
    await waitFor(() => expect(screen.queryByTestId('interview-exhausted')).toBeTruthy());
  });

  it('calls /complete and surfaces success when the FSM advance lands', async () => {
    const advancedCalls: Array<{ state: string }> = [];
    const fetchSpy = makeFetch([
      () =>
        new Response(
          JSON.stringify(fakeEnvelope({ turn: 1, aggregate: 90, meets: true })),
          { status: 200 },
        ),
      () =>
        new Response(
          JSON.stringify({ ok: true, threadId: 't-1', state: 'interview-complete' }),
          { status: 200 },
        ),
    ]);
    await act(async () => {
      render(
        <InterviewerChat
          projectId="p-8"
          fetchImpl={fetchSpy}
          onAdvanced={(i) => advancedCalls.push(i)}
        />,
      );
    });
    await waitFor(() => expect(screen.queryByTestId('interview-complete')).toBeTruthy());
    fireEvent.click(screen.getByTestId('interview-complete'));
    await waitFor(() => expect(screen.queryByTestId('interview-advanced')).toBeTruthy());
    expect(advancedCalls).toEqual([{ state: 'interview-complete' }]);
  });

  it('surfaces the force-override checkbox on a 412 from /complete', async () => {
    const fetchSpy = makeFetch([
      () =>
        new Response(
          JSON.stringify(fakeEnvelope({ turn: 1, exhausted: true, nextQuestion: null })),
          { status: 200 },
        ),
      () =>
        new Response(
          JSON.stringify({ error: 'coverage-below-threshold', aggregateScore: 40, threshold: 82 }),
          { status: 412 },
        ),
    ]);
    await act(async () => {
      render(<InterviewerChat projectId="p-9" fetchImpl={fetchSpy} />);
    });
    await waitFor(() => expect(screen.queryByTestId('interview-complete')).toBeTruthy());
    fireEvent.click(screen.getByTestId('interview-complete'));
    await waitFor(() => expect(screen.queryByTestId('interview-force-checkbox')).toBeTruthy());
  });

  it('surfaces an error message when the answer route fails', async () => {
    const fetchSpy = makeFetch([
      () =>
        new Response(JSON.stringify({ error: 'oops' }), { status: 500 }),
    ]);
    await act(async () => {
      render(<InterviewerChat projectId="p-10" fetchImpl={fetchSpy} />);
    });
    await waitFor(() => expect(screen.queryByTestId('interview-answer-error')).toBeTruthy());
    expect(screen.getByTestId('interview-answer-error').textContent).toContain('oops');
  });

  it('hydrates from initialHistory without calling the network', async () => {
    const fetchSpy = makeFetch([
      () => {
        throw new Error('should not be called');
      },
    ]);
    await act(async () => {
      render(
        <InterviewerChat
          projectId="p-11"
          fetchImpl={fetchSpy}
          initialHistory={[
            { turn: 1, role: 'agent', content: 'pre-seeded Q?' },
            { turn: 1, role: 'user', content: 'pre-seeded A.' },
          ]}
        />,
      );
    });
    expect(screen.getByTestId('history-agent-1')).toBeTruthy();
    expect(screen.getByTestId('history-user-1')).toBeTruthy();
    expect((fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
