/**
 * Vitest suite for `apps/dashboard/app/wizard/interview/page.tsx`.
 *
 * 17 cases — covers boot, chat round-trips, exit criteria (both critic-
 * accepted HANDOFF and customer "I'm done"), error paths, coverage radar
 * + summary rendering, FSM dispatch, and auto-save semantics.
 *
 * All `@caia/*` and `@chiefaia/*` modules are mocked so the test never
 * spawns a real `claude` binary. `next/navigation` is mocked because
 * jsdom has no Next router context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';

// ─── Mocks (registered before importing the page module) ─────────────────
const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('../../app/wizard/interview/actions', () => ({
  startSessionAction: vi.fn(),
  submitTurnAction: vi.fn(),
  markDoneAction: vi.fn(),
}));

vi.mock('../../app/wizard/interview/_lib/fsm', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../app/wizard/interview/_lib/fsm',
  );
  return {
    ...actual,
    dispatchFsmTransition: vi.fn().mockResolvedValue({
      ok: true,
      state: 'interview-complete',
      status: 200,
    }),
  };
});

// Mock the heavy workspace deps so importing the bridge never touches
// the real `claude` binary or @caia/interviewer playbook loader.
vi.mock('@caia/interviewer', () => ({
  Interviewer: class {
    start = vi.fn();
    submitUserReply = vi.fn();
    forceClose = vi.fn();
    snapshot = vi.fn(() => ({ rubric: { perPillarCoverage: {} } }));
    getState = vi.fn(() => 'AWAITING_USER');
    getTurnNumber = vi.fn(() => 1);
  },
  MemoryInterviewerPersistence: class {},
  loadPlaybook: vi.fn().mockResolvedValue({}),
}));
vi.mock('@chiefaia/claude-spawner', () => ({
  spawnClaude: vi.fn().mockResolvedValue({ ok: true, stdout: '{}', modelUsed: 'mock' }),
}));

// ─── Import after mocks ──────────────────────────────────────────────────
import InterviewWizardPage from '../../app/wizard/interview/page';
import {
  startSessionAction,
  submitTurnAction,
  markDoneAction,
} from '../../app/wizard/interview/actions';
import { dispatchFsmTransition } from '../../app/wizard/interview/_lib/fsm';

const mockedStart = vi.mocked(startSessionAction);
const mockedSubmit = vi.mocked(submitTurnAction);
const mockedDone = vi.mocked(markDoneAction);
const mockedFsm = vi.mocked(dispatchFsmTransition);

const baseSession = { interviewId: 'iv_test', tenantSlug: 'acme' };
const fullCoverage = Object.fromEntries(
  Array.from({ length: 16 }, (_, i) => [`B${i + 1}`, 92]),
);

function startResp(overrides: Partial<Awaited<ReturnType<typeof startSessionAction>>> = {}) {
  return {
    session: baseSession,
    agentMessage: 'Welcome — tell me about your idea.',
    turnNumber: 1,
    state: 'AWAITING_USER',
    coverage: { B1: 20 },
    ...overrides,
  };
}

function turnResp(overrides: Partial<Awaited<ReturnType<typeof submitTurnAction>>> = {}) {
  return {
    agentMessage: 'Next question…',
    turnNumber: 2,
    state: 'AWAITING_USER',
    coverage: { B1: 40, B2: 25 },
    satisfactionScore: 50,
    handoff: null,
    complete: false,
    ...overrides,
  };
}

beforeEach(() => {
  routerPush.mockReset();
  mockedStart.mockReset();
  mockedSubmit.mockReset();
  mockedDone.mockReset();
  mockedFsm.mockReset();
  mockedFsm.mockResolvedValue({ ok: true, state: 'interview-complete', status: 200 });
});

afterEach(() => {
  cleanup();
});

describe('InterviewWizardPage', () => {
  it('1. boots the session and renders the welcome agent turn', async () => {
    mockedStart.mockResolvedValue(startResp());
    await act(async () => {
      render(<InterviewWizardPage tenantSlug="acme" operatorEmail="a@b.test" />);
    });
    expect(mockedStart).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('turn-agent-1')).toHaveTextContent(
      'Welcome — tell me about your idea.',
    );
  });

  it('2. passes the tenant + operator + grand-idea down to startSessionAction', async () => {
    mockedStart.mockResolvedValue(startResp());
    await act(async () => {
      render(
        <InterviewWizardPage
          tenantSlug="acme"
          operatorEmail="founder@acme.test"
          grandIdeaPrompt="A SaaS for cats."
        />,
      );
    });
    expect(mockedStart).toHaveBeenCalledWith({
      tenantSlug: 'acme',
      operatorEmail: 'founder@acme.test',
      grandIdeaPrompt: 'A SaaS for cats.',
    });
  });

  it('3. shows an error banner when the session fails to start', async () => {
    mockedStart.mockRejectedValueOnce(new Error('db down'));
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    const alert = await screen.findByTestId('interview-error');
    expect(alert).toHaveTextContent(/Failed to start interview: db down/);
  });

  it('4. renders the 16 pillars in the radar widget on first render', async () => {
    mockedStart.mockResolvedValue(startResp());
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    expect(await screen.findByTestId('pillar-radar')).toBeInTheDocument();
    expect(screen.getByTestId('pillar-marker-B1')).toHaveAttribute('data-coverage', '20');
    expect(screen.getByTestId('pillar-marker-B16')).toHaveAttribute('data-coverage', '0');
  });

  it('5. marks pillars below the floor in red', async () => {
    mockedStart.mockResolvedValue(startResp({ coverage: { B1: 50, B2: 90 } }));
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    await screen.findByTestId('pillar-marker-B1');
    expect(screen.getByTestId('pillar-marker-B1')).toHaveAttribute('data-below-floor', 'true');
    expect(screen.getByTestId('pillar-marker-B2')).toHaveAttribute('data-below-floor', 'false');
  });

  it('6. disables Send while the boot call is in flight', async () => {
    let resolveStart!: (v: unknown) => void;
    mockedStart.mockReturnValueOnce(new Promise((r) => { resolveStart = r as any; }) as any);
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    expect(screen.getByTestId('chat-send')).toBeDisabled();
    await act(async () => { resolveStart(startResp()); });
  });

  it('7. submits a user turn via submitTurnAction and appends the agent reply', async () => {
    mockedStart.mockResolvedValue(startResp());
    mockedSubmit.mockResolvedValue(turnResp());
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    await screen.findByTestId('turn-agent-1');
    const input = screen.getByTestId('chat-input');
    const user = userEvent.setup();
    await user.type(input, 'My idea is a marketplace.');
    await user.click(screen.getByTestId('chat-send'));
    expect(mockedSubmit).toHaveBeenCalledWith(baseSession, 'My idea is a marketplace.');
    expect(await screen.findByTestId('turn-agent-2')).toHaveTextContent('Next question…');
  });

  it('8. updates the coverage radar and satisfaction score on each turn', async () => {
    mockedStart.mockResolvedValue(startResp());
    mockedSubmit.mockResolvedValue(turnResp({ satisfactionScore: 73, coverage: { B5: 80 } }));
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    await screen.findByTestId('turn-agent-1');
    const user = userEvent.setup();
    await user.type(screen.getByTestId('chat-input'), 'Answer 1');
    await user.click(screen.getByTestId('chat-send'));
    await screen.findByTestId('turn-agent-2');
    expect(screen.getByTestId('satisfaction-score')).toHaveTextContent('73');
    expect(screen.getByTestId('pillar-marker-B5')).toHaveAttribute('data-coverage', '80');
  });

  it('9. shows the "I\'m done" force-close button and disables it after completion', async () => {
    mockedStart.mockResolvedValue(startResp());
    mockedDone.mockResolvedValue(
      turnResp({ state: 'FORCE_CLOSED', complete: true, handoff: { id: 'plan_1' } }),
    );
    await act(async () => {
      render(<InterviewWizardPage onComplete={() => {}} />);
    });
    await screen.findByTestId('turn-agent-1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-done'));
    });
    expect(mockedDone).toHaveBeenCalledWith(baseSession);
    expect(screen.getByTestId('chat-done')).toBeDisabled();
  });

  it('10. dispatches the FSM transition when the engine returns HANDOFF', async () => {
    mockedStart.mockResolvedValue(startResp());
    mockedSubmit.mockResolvedValue(
      turnResp({ state: 'HANDOFF', complete: true, satisfactionScore: 88, handoff: { ok: true } }),
    );
    const onComplete = vi.fn();
    await act(async () => {
      render(<InterviewWizardPage projectId="proj-42" onComplete={onComplete} />);
    });
    await screen.findByTestId('turn-agent-1');
    const user = userEvent.setup();
    await user.type(screen.getByTestId('chat-input'), 'final answer');
    await user.click(screen.getByTestId('chat-send'));
    await screen.findByTestId('interview-completion-banner');
    expect(mockedFsm).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-42',
        from: 'interviewing',
        to: 'interview-complete',
      }),
    );
    expect(onComplete).toHaveBeenCalledWith({ ok: true });
  });

  it('11. dispatches the FSM transition when the customer marks done', async () => {
    mockedStart.mockResolvedValue(startResp());
    mockedDone.mockResolvedValue(
      turnResp({ state: 'FORCE_CLOSED', complete: true, handoff: null }),
    );
    const onComplete = vi.fn();
    await act(async () => {
      render(<InterviewWizardPage projectId="proj-7" onComplete={onComplete} />);
    });
    await screen.findByTestId('turn-agent-1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-done'));
    });
    await screen.findByTestId('interview-completion-banner');
    expect(mockedFsm).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'proj-7', to: 'interview-complete' }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('12. surfaces errors from submitTurnAction without losing prior turns', async () => {
    mockedStart.mockResolvedValue(startResp());
    mockedSubmit.mockRejectedValue(new Error('LLM timeout'));
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    await screen.findByTestId('turn-agent-1');
    const user = userEvent.setup();
    await user.type(screen.getByTestId('chat-input'), 'hello');
    await user.click(screen.getByTestId('chat-send'));
    expect(await screen.findByTestId('interview-error')).toHaveTextContent(/LLM timeout/);
    // Prior agent turn still visible
    expect(screen.getByTestId('turn-agent-1')).toBeInTheDocument();
  });

  it('13. auto-saves on every turn (submitTurnAction is the persistence call site)', async () => {
    mockedStart.mockResolvedValue(startResp());
    mockedSubmit
      .mockResolvedValueOnce(turnResp({ turnNumber: 2 }))
      .mockResolvedValueOnce(turnResp({ turnNumber: 3, agentMessage: 'Q3' }));
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    await screen.findByTestId('turn-agent-1');
    const user = userEvent.setup();
    await user.type(screen.getByTestId('chat-input'), 'A1');
    await user.click(screen.getByTestId('chat-send'));
    await screen.findByTestId('turn-agent-2');
    await user.type(screen.getByTestId('chat-input'), 'A2');
    await user.click(screen.getByTestId('chat-send'));
    await screen.findByTestId('turn-agent-3');
    expect(mockedSubmit).toHaveBeenCalledTimes(2);
  });

  it('14. ignores empty-string sends', async () => {
    mockedStart.mockResolvedValue(startResp());
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    await screen.findByTestId('turn-agent-1');
    // Send button is disabled when draft is empty
    expect(screen.getByTestId('chat-send')).toBeDisabled();
    // Pressing Enter with empty input does nothing
    const input = screen.getByTestId('chat-input');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('15. supports Enter-to-send and clears the draft after sending', async () => {
    mockedStart.mockResolvedValue(startResp());
    mockedSubmit.mockResolvedValue(turnResp());
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    await screen.findByTestId('turn-agent-1');
    const input = screen.getByTestId('chat-input') as HTMLInputElement;
    const user = userEvent.setup();
    await user.type(input, 'hello world');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(mockedSubmit).toHaveBeenCalledWith(baseSession, 'hello world');
    await screen.findByTestId('turn-agent-2');
    expect(input.value).toBe('');
  });

  it('16. shows "16 / 16 pillars at floor" when coverage is saturated', async () => {
    mockedStart.mockResolvedValue(startResp({ coverage: fullCoverage }));
    await act(async () => {
      render(<InterviewWizardPage />);
    });
    expect(await screen.findByTestId('coverage-count')).toHaveTextContent('16');
  });

  it('17. proceeds to next step even if the FSM endpoint returns non-ok (degrades gracefully)', async () => {
    mockedFsm.mockResolvedValueOnce({ ok: false, state: null, status: 404 });
    mockedStart.mockResolvedValue(startResp());
    mockedDone.mockResolvedValue(
      turnResp({ state: 'FORCE_CLOSED', complete: true, handoff: null }),
    );
    const onComplete = vi.fn();
    await act(async () => {
      render(<InterviewWizardPage onComplete={onComplete} />);
    });
    await screen.findByTestId('turn-agent-1');
    await act(async () => {
      fireEvent.click(screen.getByTestId('chat-done'));
    });
    await screen.findByTestId('interview-completion-banner');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
