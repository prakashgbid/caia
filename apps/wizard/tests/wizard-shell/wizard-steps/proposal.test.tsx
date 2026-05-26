/**
 * @vitest-environment jsdom
 *
 * Unit tests for the Step 5 proposal wizard page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProposalPanel as ProposalPage } from '../../../components/wizard/ProposalPanel';

afterEach(() => cleanup());

function makeFetchSpy(
  pathToResponse: (url: string, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  const spy = vi.fn(async (url: unknown, init?: RequestInit) =>
    pathToResponse(typeof url === 'string' ? url : String(url), init),
  );
  return spy as unknown as typeof fetch;
}

const STUB_PROPOSAL = {
  ok: true,
  proposal: {
    execSummaryMd: '# Executive Summary\n\nStub.',
    fullProposalMd: '# Full proposal\n\nStub.',
    onePagerMd: '# One-pager\n\nStub.',
    revisionNumber: 1,
  },
  designAppPrompt: {
    target: 'claude_design',
    promptText: 'Design a dashboard.',
    reviewerScore: 88,
    reviewerBadge: 'ship',
  },
  cacheHit: false,
  source: 'memory',
};

describe('<ProposalPage>', () => {
  it('renders the wizard-step-proposal Card', () => {
    render(<ProposalPage />);
    expect(screen.getByTestId('wizard-step-proposal')).toBeTruthy();
  });

  it('renders the generate button', () => {
    render(<ProposalPage />);
    expect(screen.getByTestId('generate-proposal')).toBeTruthy();
  });

  it('POSTs to /api/wizard/proposal/generate when "Generate" is clicked', async () => {
    const fetchSpy = makeFetchSpy(
      async () => new Response(JSON.stringify(STUB_PROPOSAL), { status: 200 }),
    );
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    const calls = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0]?.[0]).toBe('/api/wizard/proposal/generate');
    const init = calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
  });

  it('renders the three Markdown renderers as Accordion items', async () => {
    const fetchSpy = makeFetchSpy(
      async () => new Response(JSON.stringify(STUB_PROPOSAL), { status: 200 }),
    );
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('renderer-exec')).toBeTruthy();
    expect(screen.getByTestId('renderer-full')).toBeTruthy();
    expect(screen.getByTestId('renderer-onepager')).toBeTruthy();
  });

  it('shows the reviewer badge', async () => {
    const fetchSpy = makeFetchSpy(
      async () => new Response(JSON.stringify(STUB_PROPOSAL), { status: 200 }),
    );
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('proposal-reviewer-badge').textContent).toContain('ship');
    expect(screen.getByTestId('proposal-reviewer-badge').textContent).toContain('88');
  });

  it('renders the design-app prompt section', async () => {
    const fetchSpy = makeFetchSpy(
      async () => new Response(JSON.stringify(STUB_PROPOSAL), { status: 200 }),
    );
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('renderer-design-prompt')).toBeTruthy();
  });

  it('renders an error message when the route fails', async () => {
    const fetchSpy = makeFetchSpy(
      async () =>
        new Response(JSON.stringify({ error: 'proposal-generation-failed' }), {
          status: 500,
        }),
    );
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('generate-error').textContent).toContain('proposal-generation-failed');
  });

  it('cache-hit badge appears when source returns cacheHit:true', async () => {
    const cacheHitResponse = { ...STUB_PROPOSAL, cacheHit: true };
    const fetchSpy = makeFetchSpy(
      async () => new Response(JSON.stringify(cacheHitResponse), { status: 200 }),
    );
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('proposal-cache-hit')).toBeTruthy();
  });

  it('PATCHes the wizard state to proposal-generated on Approve', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const fetchSpy = makeFetchSpy(async (url, init) => {
      calls.push({
        url,
        body: init?.body ? JSON.parse(init.body as string) : undefined,
      });
      if (url.includes('/state')) {
        return new Response(JSON.stringify({ state: 'proposal-generated' }), { status: 200 });
      }
      return new Response(JSON.stringify(STUB_PROPOSAL), { status: 200 });
    });
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.change(screen.getByTestId('proposal-project-id'), {
      target: { value: 'p-42' },
    });
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(screen.getByTestId('approve-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    const patch = calls.find((c) => c.url === '/api/wizard/p-42/state');
    expect(patch).toBeTruthy();
    expect((patch!.body as { targetState: string }).targetState).toBe('proposal-generated');
  });

  it('renders a soft message on 409 transition conflict', async () => {
    const fetchSpy = makeFetchSpy(async (url) => {
      if (url.includes('/state')) {
        return new Response(JSON.stringify({ error: 'invalid-transition' }), { status: 409 });
      }
      return new Response(JSON.stringify(STUB_PROPOSAL), { status: 200 });
    });
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(screen.getByTestId('approve-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('approve-message').textContent).toContain('Already');
  });

  it('renders an error on a non-409 approve failure', async () => {
    const fetchSpy = makeFetchSpy(async (url) => {
      if (url.includes('/state')) {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      return new Response(JSON.stringify(STUB_PROPOSAL), { status: 200 });
    });
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    fireEvent.click(screen.getByTestId('approve-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('approve-error').textContent).toContain('boom');
  });

  it('renders the proposal source badge', async () => {
    const fetchSpy = makeFetchSpy(
      async () => new Response(JSON.stringify(STUB_PROPOSAL), { status: 200 }),
    );
    render(<ProposalPage fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('generate-proposal'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('proposal-source').textContent).toBe('memory');
  });
});
