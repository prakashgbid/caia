/**
 * @vitest-environment jsdom
 *
 * Unit tests for the Step 6 design wizard page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import DesignPage from '../../../app/wizard/design/page';

afterEach(() => cleanup());

function makeFetchSpy(
  pathToResponse: (url: string) => Response | Promise<Response>,
): typeof fetch {
  const spy = vi.fn(async (url: unknown) =>
    pathToResponse(typeof url === 'string' ? url : String(url)),
  );
  return spy as unknown as typeof fetch;
}

describe('<DesignPage>', () => {
  it('renders the wizard-step-design Card', () => {
    render(<DesignPage />);
    expect(screen.getByTestId('wizard-step-design')).toBeTruthy();
  });

  it('renders the design-prompt code block', () => {
    render(<DesignPage />);
    expect(screen.getByTestId('design-prompt-text')).toBeTruthy();
  });

  it('initial prompt text comes from the prop override', () => {
    render(<DesignPage initialPromptText="HELLO DESIGN PROMPT" />);
    expect(screen.getByTestId('design-prompt-text').textContent).toBe('HELLO DESIGN PROMPT');
  });

  it('Copy button writes the prompt to the clipboard', async () => {
    const writes: string[] = [];
    render(
      <DesignPage
        initialPromptText="MY PROMPT"
        clipboardWriter={(text: string) => {
          writes.push(text);
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('copy-prompt'));
    await new Promise((r) => setTimeout(r, 10));
    expect(writes).toEqual(['MY PROMPT']);
  });

  it('shows the Copied! label after a successful copy', async () => {
    render(
      <DesignPage
        initialPromptText="X"
        clipboardWriter={async () => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('copy-prompt'));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('copy-prompt').textContent).toContain('Copied');
  });

  it('shows a copy error when clipboard writer throws', async () => {
    render(
      <DesignPage
        initialPromptText="X"
        clipboardWriter={() => {
          throw new Error('no clipboard');
        }}
      />,
    );
    fireEvent.click(screen.getByTestId('copy-prompt'));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('copy-error')).toBeTruthy();
  });

  it('opens the upload dialog when the CTA is clicked', () => {
    render(<DesignPage />);
    fireEvent.click(screen.getByTestId('open-upload-dialog'));
    expect(screen.getByTestId('upload-dialog')).toBeTruthy();
  });

  it('refuses upload when no URL is entered', async () => {
    render(<DesignPage initialProjectId="p-1" />);
    fireEvent.click(screen.getByTestId('open-upload-dialog'));
    fireEvent.click(screen.getByTestId('confirm-upload'));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('upload-error').textContent).toContain('URL');
  });

  it('PATCHes the wizard state on confirm-upload', async () => {
    const calls: string[] = [];
    const fetchSpy = makeFetchSpy((url) => {
      calls.push(url);
      return new Response(JSON.stringify({ state: 'design-uploaded' }), { status: 200 });
    });
    render(<DesignPage initialProjectId="p-99" fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('open-upload-dialog'));
    fireEvent.change(screen.getByTestId('upload-url'), {
      target: { value: 'https://example.com/design.zip' },
    });
    fireEvent.click(screen.getByTestId('confirm-upload'));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual(['/api/wizard/p-99/state']);
  });

  it('shows an upload message on success', async () => {
    const fetchSpy = makeFetchSpy(
      async () => new Response(JSON.stringify({ state: 'design-uploaded' }), { status: 200 }),
    );
    render(<DesignPage initialProjectId="p-1" fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('open-upload-dialog'));
    fireEvent.change(screen.getByTestId('upload-url'), {
      target: { value: 'https://example.com/design.zip' },
    });
    fireEvent.click(screen.getByTestId('confirm-upload'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('upload-message').textContent).toContain('Design uploaded');
  });

  it('handles a 409 as already-uploaded', async () => {
    const fetchSpy = makeFetchSpy(
      async () => new Response(JSON.stringify({ error: 'invalid-transition' }), { status: 409 }),
    );
    render(<DesignPage initialProjectId="p-1" fetchImpl={fetchSpy} />);
    fireEvent.click(screen.getByTestId('open-upload-dialog'));
    fireEvent.change(screen.getByTestId('upload-url'), {
      target: { value: 'https://example.com/design.zip' },
    });
    fireEvent.click(screen.getByTestId('confirm-upload'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('upload-message').textContent).toContain('Already');
  });

  it('renders the source selector with @caia/design-ingest SOURCE_NAMES', () => {
    render(<DesignPage />);
    fireEvent.click(screen.getByTestId('open-upload-dialog'));
    const sel = screen.getByTestId('upload-source') as HTMLSelectElement;
    expect(sel.options.length).toBeGreaterThan(0);
  });

  it('reset-prompt restores the initial prompt text', () => {
    render(<DesignPage initialPromptText="ORIGINAL" />);
    expect(screen.getByTestId('design-prompt-text').textContent).toBe('ORIGINAL');
    fireEvent.click(screen.getByTestId('reset-prompt'));
    expect(screen.getByTestId('design-prompt-text').textContent).toBe('ORIGINAL');
  });
});
