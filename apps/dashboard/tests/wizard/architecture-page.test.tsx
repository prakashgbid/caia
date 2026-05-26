/**
 * Vitest suite for `apps/dashboard/app/wizard/architecture/page.tsx`.
 *
 * 16 cases — covers idle → running → ready transitions, error + retry
 * + regenerate paths, accordion content rendering for each of the 3
 * artifacts, FSM dispatch on accept, and the loading-state ticker.
 *
 * All `@caia/*` and `@chiefaia/*` modules are mocked so the test never
 * spawns a real `claude` binary. `next/navigation` is mocked because
 * jsdom has no Next router context.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import * as React from 'react';

const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('../../app/wizard/architecture/actions', () => ({
  runIaAction: vi.fn(),
}));

vi.mock('../../app/wizard/architecture/_lib/fsm', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../app/wizard/architecture/_lib/fsm',
  );
  return {
    ...actual,
    dispatchFsmTransition: vi.fn().mockResolvedValue({
      ok: true,
      state: 'information-architecture-complete',
      status: 200,
    }),
  };
});

vi.mock('@caia/info-architect', () => ({
  IaMemoryPersistence: class {},
  InfoArchitectAgent: class { design = vi.fn(); },
  runInformationArchitecture: vi.fn(),
}));
vi.mock('@caia/state-machine', () => ({}));
vi.mock('@chiefaia/claude-spawner', () => ({
  spawnClaude: vi.fn().mockResolvedValue({ ok: true, stdout: '{}' }),
}));

import ArchitectureWizardPage from '../../app/wizard/architecture/page';
import { runIaAction } from '../../app/wizard/architecture/actions';
import { dispatchFsmTransition } from '../../app/wizard/architecture/_lib/fsm';

const mockedRunIa = vi.mocked(runIaAction);
const mockedFsm = vi.mocked(dispatchFsmTransition);

function iaResult(over: Partial<Awaited<ReturnType<typeof runIaAction>>> = {}) {
  return {
    projectId: 'proj-1',
    iaRevisionId: 'iar_001',
    writtenAtIso: new Date().toISOString(),
    fsmTransitions: [],
    output: {
      pagesCatalogue: {
        revisionId: 'pc_001',
        pages: [
          { id: 'home', template: 'marketing/hero', stack: ['hero', 'features'] },
          { id: 'pricing', template: 'marketing/pricing', stack: ['plans'] },
        ],
      },
      designSystem: {
        revisionId: 'ds_001',
        tokens: {
          colors: { primary: '#3b82f6', surface: '#0f1117' },
          typography: { body: 'Inter, sans-serif' },
          spacing: { sm: 8, md: 16 },
        },
      },
      componentsLibrary: {
        revisionId: 'cl_001',
        components: [
          { id: 'cmp_hero', tier: 'organism' },
          { id: 'cmp_button', tier: 'atom' },
        ],
      },
    },
    ...over,
  };
}

beforeEach(() => {
  routerPush.mockReset();
  mockedRunIa.mockReset();
  mockedFsm.mockReset();
  mockedFsm.mockResolvedValue({
    ok: true,
    state: 'information-architecture-complete',
    status: 200,
  });
});

afterEach(() => {
  cleanup();
});

describe('ArchitectureWizardPage', () => {
  it('1. renders the idle CTA on first mount', () => {
    render(<ArchitectureWizardPage />);
    expect(screen.getByTestId('generate-ia-button')).toHaveTextContent(
      /generate information architecture/i,
    );
    expect(screen.getByTestId('wizard-architecture-page')).toHaveAttribute(
      'data-phase',
      'idle',
    );
  });

  it('2. transitions to "running" and shows the loading panel when generate is clicked', async () => {
    let resolve!: (v: unknown) => void;
    mockedRunIa.mockReturnValueOnce(new Promise((r) => { resolve = r as any; }) as any);
    render(<ArchitectureWizardPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    expect(screen.getByTestId('wizard-architecture-page')).toHaveAttribute('data-phase', 'running');
    expect(screen.getByTestId('ia-loading')).toBeInTheDocument();
    await act(async () => { resolve(iaResult()); });
  });

  it('3. transitions to "ready" and renders all three artifact cards on success', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    render(<ArchitectureWizardPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    expect(await screen.findByTestId('ia-artifacts-container')).toBeInTheDocument();
    expect(screen.getByTestId('accordion-item-pages-catalogue')).toBeInTheDocument();
    expect(screen.getByTestId('accordion-item-design-system')).toBeInTheDocument();
    expect(screen.getByTestId('accordion-item-components-library')).toBeInTheDocument();
  });

  it('4. opens the pages-catalogue accordion by default and shows JSON content', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    render(<ArchitectureWizardPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    await screen.findByTestId('pages-catalogue-json');
    expect(screen.getByTestId('pages-catalogue-json').textContent).toContain('"home"');
    expect(screen.getByTestId('pages-catalogue-json').textContent).toContain('marketing/hero');
  });

  it('5. expands the design-system accordion when its trigger is clicked', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    render(<ArchitectureWizardPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    await screen.findByTestId('accordion-trigger-design-system');
    expect(screen.queryByTestId('design-system-json')).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByTestId('accordion-trigger-design-system'));
    });
    expect(screen.getByTestId('design-system-json').textContent).toContain('#3b82f6');
  });

  it('6. shows badge counts on each accordion (pages / tokens / components)', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    render(<ArchitectureWizardPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    await screen.findByTestId('accordion-badge-pages-catalogue');
    expect(screen.getByTestId('accordion-badge-pages-catalogue')).toHaveTextContent('2');
    expect(screen.getByTestId('accordion-badge-design-system')).toHaveTextContent('5');
    expect(screen.getByTestId('accordion-badge-components-library')).toHaveTextContent('2');
  });

  it('7. dispatches FSM transition and calls onComplete when "Looks good" is pressed', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    const onComplete = vi.fn();
    render(
      <ArchitectureWizardPage projectId="proj-99" onComplete={onComplete} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    await screen.findByTestId('accept-ia-button');
    await act(async () => {
      fireEvent.click(screen.getByTestId('accept-ia-button'));
    });
    expect(mockedFsm).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-99',
        from: 'information-architecture-in-progress',
        to: 'information-architecture-complete',
      }),
    );
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('8. renders the completion banner after accept', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    render(<ArchitectureWizardPage onComplete={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    await screen.findByTestId('accept-ia-button');
    await act(async () => {
      fireEvent.click(screen.getByTestId('accept-ia-button'));
    });
    expect(await screen.findByTestId('ia-completion-banner')).toBeInTheDocument();
  });

  it('9. surfaces an error and a retry button when the agent throws', async () => {
    mockedRunIa.mockRejectedValueOnce(new Error('claude budget exhausted'));
    render(<ArchitectureWizardPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    expect(await screen.findByTestId('ia-error')).toHaveTextContent(/claude budget exhausted/);
    expect(screen.getByTestId('ia-retry')).toBeInTheDocument();
  });

  it('10. retry resets phase back to idle and clears the error', async () => {
    mockedRunIa.mockRejectedValueOnce(new Error('boom'));
    render(<ArchitectureWizardPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    await screen.findByTestId('ia-retry');
    await act(async () => {
      fireEvent.click(screen.getByTestId('ia-retry'));
    });
    expect(screen.getByTestId('wizard-architecture-page')).toHaveAttribute('data-phase', 'idle');
    expect(screen.queryByTestId('ia-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('generate-ia-button')).toBeInTheDocument();
  });

  it('11. regenerate runs the agent a second time', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    mockedRunIa.mockResolvedValueOnce(iaResult());
    render(<ArchitectureWizardPage onComplete={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    await screen.findByTestId('regenerate-ia-button');
    await act(async () => {
      fireEvent.click(screen.getByTestId('regenerate-ia-button'));
    });
    expect(mockedRunIa).toHaveBeenCalledTimes(2);
  });

  it('12. shows an elapsed-time counter during the running phase', async () => {
    vi.useFakeTimers();
    let resolve!: (v: unknown) => void;
    mockedRunIa.mockReturnValueOnce(new Promise((r) => { resolve = r as any; }) as any);
    render(<ArchitectureWizardPage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    expect(screen.getByTestId('ia-elapsed')).toHaveTextContent('0');
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });
    expect(screen.getByTestId('ia-elapsed')).toHaveTextContent('2');
    await act(async () => { resolve(iaResult()); });
    vi.useRealTimers();
  });

  it('13. does NOT render artifacts container before the IA run resolves', () => {
    render(<ArchitectureWizardPage />);
    expect(screen.queryByTestId('ia-artifacts-container')).not.toBeInTheDocument();
  });

  it('14. passes projectId + tenantSlug into runIaAction', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    render(<ArchitectureWizardPage projectId="p1" tenantSlug="acme" />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    expect(mockedRunIa).toHaveBeenCalledWith({ projectId: 'p1', tenantSlug: 'acme' });
  });

  it('15. shows "Saving…" on the accept button while finalizing', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    let resolveFsm!: (v: unknown) => void;
    mockedFsm.mockReturnValueOnce(new Promise((r) => { resolveFsm = r as any; }) as any);
    render(<ArchitectureWizardPage onComplete={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    await screen.findByTestId('accept-ia-button');
    await act(async () => {
      fireEvent.click(screen.getByTestId('accept-ia-button'));
    });
    expect(screen.getByTestId('accept-ia-button')).toHaveTextContent(/Saving/);
    await act(async () => { resolveFsm({ ok: true, state: 'information-architecture-complete', status: 200 }); });
  });

  it('16. surfaces an error if FSM dispatch throws', async () => {
    mockedRunIa.mockResolvedValueOnce(iaResult());
    mockedFsm.mockRejectedValueOnce(new Error('FSM unreachable'));
    render(<ArchitectureWizardPage onComplete={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('generate-ia-button'));
    });
    await screen.findByTestId('accept-ia-button');
    await act(async () => {
      fireEvent.click(screen.getByTestId('accept-ia-button'));
    });
    expect(await screen.findByTestId('ia-error')).toHaveTextContent(/FSM unreachable/);
  });
});
