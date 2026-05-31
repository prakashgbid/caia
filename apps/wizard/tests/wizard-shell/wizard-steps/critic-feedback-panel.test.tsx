/**
 * @vitest-environment jsdom
 *
 * Unit tests for `<CriticFeedbackPanel>` (Phase B B6).
 *
 * The panel is the inline modification surface for the IA + Interview
 * critic loops. We assert:
 *
 *   - feedback rendering (5 cases)
 *   - selection / dismissal behaviour (4 cases)
 *   - apply-and-rerun flow (4 cases)
 *   - loading state (2 cases)
 *   - empty-modifications variant (1 case)
 *
 * Tests inject `fetchImpl` so the suite never hits a real network.
 * 16 cases total. The brief requested >=15.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  CriticFeedbackPanel,
  type CriticFeedback,
} from '../../../components/wizard/CriticFeedbackPanel';

afterEach(() => cleanup());

const BASE_FEEDBACK: CriticFeedback = {
  kind: 'approved-with-modifications',
  step: 'architecture',
  modifications: [
    {
      id: 'mod-1',
      title: 'Tighten the Atlas page hierarchy',
      description: 'The Atlas page should be 1 level deeper.',
      severity: 'p2',
      category: 'pages',
    },
    {
      id: 'mod-2',
      title: 'Add a destructive variant to Button',
      description: 'Design system is missing the destructive variant.',
      severity: 'p1',
      category: 'design-system',
    },
  ],
  rerunEndpoint: '/api/wizard/architecture/run',
  rerunBody: { tenantProjectId: 'p-1' },
};

function makeFetchOk(responseBody: unknown = { ok: true }) {
  return vi.fn(async () =>
    new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

function makeFetchFail(status = 500, errorBody: unknown = { error: 'boom' }) {
  return vi.fn(async () =>
    new Response(JSON.stringify(errorBody), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

function pendingFetch(): { fetchImpl: typeof fetch; resolve: (v?: unknown) => void } {
  let resolve!: (v?: unknown) => void;
  const promise = new Promise<unknown>((r) => {
    resolve = r;
  });
  const fetchImpl = vi.fn(
    async () =>
      (await promise) as Response,
  ) as unknown as typeof fetch;
  return { fetchImpl, resolve: resolve as (v?: unknown) => void };
}

describe('<CriticFeedbackPanel> rendering', () => {
  it('renders the approved-with-modifications title for the IA step', () => {
    render(<CriticFeedbackPanel feedback={BASE_FEEDBACK} />);
    expect(screen.getByText(/Critic suggests refinements/)).toBeTruthy();
    expect(screen.getByTestId('critic-feedback-architecture')).toBeTruthy();
    expect(screen.getByTestId('critic-feedback-step').textContent).toContain(
      'Step 4 — Architecture',
    );
  });

  it('renders the coverage-insufficient title for the Interview step', () => {
    render(
      <CriticFeedbackPanel
        feedback={{
          ...BASE_FEEDBACK,
          kind: 'coverage-insufficient',
          step: 'interview',
        }}
      />,
    );
    expect(screen.getByText(/Critic wants more coverage/)).toBeTruthy();
    expect(screen.getByTestId('critic-feedback-step').textContent).toContain(
      'Step 3 — Interview',
    );
  });

  it('renders one accordion item per modification', () => {
    render(<CriticFeedbackPanel feedback={BASE_FEEDBACK} />);
    expect(screen.getByTestId('critic-modification-mod-1')).toBeTruthy();
    expect(screen.getByTestId('critic-modification-mod-2')).toBeTruthy();
  });

  it('renders severity badges when present', () => {
    render(<CriticFeedbackPanel feedback={BASE_FEEDBACK} />);
    expect(
      screen.getByTestId('critic-modification-severity-mod-1').textContent,
    ).toBe('p2');
    expect(
      screen.getByTestId('critic-modification-severity-mod-2').textContent,
    ).toBe('p1');
  });

  it('renders category badges when present', () => {
    render(<CriticFeedbackPanel feedback={BASE_FEEDBACK} />);
    expect(
      screen.getByTestId('critic-modification-category-mod-1').textContent,
    ).toBe('pages');
  });
});

describe('<CriticFeedbackPanel> selection + dismissal', () => {
  it('selects all modifications by default', () => {
    render(<CriticFeedbackPanel feedback={BASE_FEEDBACK} />);
    const cb1 = screen.getByTestId(
      'critic-modification-checkbox-mod-1',
    ) as HTMLInputElement;
    const cb2 = screen.getByTestId(
      'critic-modification-checkbox-mod-2',
    ) as HTMLInputElement;
    expect(cb1.checked).toBe(true);
    expect(cb2.checked).toBe(true);
  });

  it('toggles a checkbox off when clicked', () => {
    render(<CriticFeedbackPanel feedback={BASE_FEEDBACK} />);
    const cb1 = screen.getByTestId(
      'critic-modification-checkbox-mod-1',
    ) as HTMLInputElement;
    fireEvent.click(cb1);
    expect(cb1.checked).toBe(false);
  });

  it('calls onDismiss when Dismiss is clicked', () => {
    const onDismiss = vi.fn();
    render(
      <CriticFeedbackPanel feedback={BASE_FEEDBACK} onDismiss={onDismiss} />,
    );
    fireEvent.click(screen.getByTestId('critic-feedback-dismiss'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Dismiss does NOT trigger a fetch', () => {
    const fetchImpl = vi.fn();
    render(
      <CriticFeedbackPanel
        feedback={BASE_FEEDBACK}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );
    fireEvent.click(screen.getByTestId('critic-feedback-dismiss'));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('<CriticFeedbackPanel> apply-and-rerun', () => {
  it('POSTs the selected modification ids to the rerunEndpoint', async () => {
    const fetchImpl = makeFetchOk({ ok: true, attemptsRun: 1 });
    render(
      <CriticFeedbackPanel feedback={BASE_FEEDBACK} fetchImpl={fetchImpl} />,
    );
    fireEvent.click(screen.getByTestId('critic-feedback-rerun'));
    await waitFor(() => {
      expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/wizard/architecture/run');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as {
      tenantProjectId: string;
      applyModifications: string[];
    };
    expect(body.tenantProjectId).toBe('p-1');
    expect(body.applyModifications.sort()).toEqual(['mod-1', 'mod-2']);
  });

  it('omits a modification id from the POST body when its checkbox is unchecked', async () => {
    const fetchImpl = makeFetchOk();
    render(
      <CriticFeedbackPanel feedback={BASE_FEEDBACK} fetchImpl={fetchImpl} />,
    );
    fireEvent.click(screen.getByTestId('critic-modification-checkbox-mod-1'));
    fireEvent.click(screen.getByTestId('critic-feedback-rerun'));
    await waitFor(() => {
      expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    });
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    const body = JSON.parse(init.body as string) as {
      applyModifications: string[];
    };
    expect(body.applyModifications).toEqual(['mod-2']);
  });

  it('calls onRerunSuccess with the parsed response body', async () => {
    const onRerunSuccess = vi.fn();
    const fetchImpl = makeFetchOk({ ok: true, status: 'approved' });
    render(
      <CriticFeedbackPanel
        feedback={BASE_FEEDBACK}
        fetchImpl={fetchImpl}
        onRerunSuccess={onRerunSuccess}
      />,
    );
    fireEvent.click(screen.getByTestId('critic-feedback-rerun'));
    await waitFor(() => {
      expect(onRerunSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onRerunSuccess.mock.calls[0]?.[0]).toEqual({
      ok: true,
      status: 'approved',
    });
  });

  it('surfaces a server error message when the rerun POST fails', async () => {
    const fetchImpl = makeFetchFail(500, { error: 'critic-rerun-failed' });
    render(
      <CriticFeedbackPanel feedback={BASE_FEEDBACK} fetchImpl={fetchImpl} />,
    );
    fireEvent.click(screen.getByTestId('critic-feedback-rerun'));
    await waitFor(() => {
      expect(screen.queryByTestId('critic-feedback-error')).not.toBeNull();
    });
    expect(screen.getByTestId('critic-feedback-error').textContent).toContain(
      'critic-rerun-failed',
    );
  });
});

describe('<CriticFeedbackPanel> loading state', () => {
  it('shows "Rerunning…" copy while the rerun is in flight', async () => {
    const { fetchImpl, resolve } = pendingFetch();
    render(
      <CriticFeedbackPanel feedback={BASE_FEEDBACK} fetchImpl={fetchImpl} />,
    );
    fireEvent.click(screen.getByTestId('critic-feedback-rerun'));
    await waitFor(() => {
      expect(screen.getByTestId('critic-feedback-rerun').textContent).toBe(
        'Rerunning…',
      );
    });
    resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });

  it('disables both Apply and Dismiss while the rerun is in flight', async () => {
    const { fetchImpl, resolve } = pendingFetch();
    render(
      <CriticFeedbackPanel feedback={BASE_FEEDBACK} fetchImpl={fetchImpl} />,
    );
    fireEvent.click(screen.getByTestId('critic-feedback-rerun'));
    await waitFor(() => {
      expect(
        (screen.getByTestId('critic-feedback-rerun') as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    });
    expect(
      (screen.getByTestId('critic-feedback-dismiss') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });
});

describe('<CriticFeedbackPanel> empty modifications', () => {
  it('renders a placeholder when modifications is empty', () => {
    render(
      <CriticFeedbackPanel
        feedback={{ ...BASE_FEEDBACK, modifications: [] }}
      />,
    );
    expect(screen.getByTestId('critic-feedback-empty')).toBeTruthy();
    expect(screen.queryByTestId('critic-feedback-accordion')).toBeNull();
  });
});
