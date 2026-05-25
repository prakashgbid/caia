import { afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";

afterEach(() => cleanup());
import { describe, expect, it, vi } from 'vitest';

import { GrandIdeaForm } from '../src/ui-component.js';
import type { CaptureResponse } from '../src/types.js';

const TENANT_SLUG = 'prakash-tiwari';
const PROJECT_ID = '44444444-4444-4444-4444-444444444444';
const validPrompt =
  'A newsletter with three open source releases each morning, free tier always.';

function okFetch(): typeof fetch {
  const body: CaptureResponse = {
    ok: true,
    grandIdeaId: 'mem-1',
    revisionNumber: 1,
    capturedAtIso: '2026-05-25T00:00:00.000Z',
    newState: 'idea-captured',
    newRowCreated: true,
    fsmAdvanced: true,
  };
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 201 })) as unknown as typeof fetch;
}

function errFetch(error = 'tenant_not_onboarded'): typeof fetch {
  const body: CaptureResponse = {
    ok: false,
    error: error as CaptureResponse extends { error: infer E } ? E : never,
    message: 'tenant has not completed onboarding',
  };
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 409 })) as unknown as typeof fetch;
}

describe('GrandIdeaForm', () => {
  it('renders the heading, textarea, and submit button', () => {
    render(
      <GrandIdeaForm
        tenantSlug={TENANT_SLUG}
        projectId={PROJECT_ID}
        fetchImpl={okFetch()}
      />,
    );
    expect(screen.getByText(/tell me about your idea/i)).toBeTruthy();
    expect(screen.getByTestId('grand-idea-prompt')).toBeTruthy();
    expect(screen.getByTestId('submit')).toBeTruthy();
  });

  it('disables submit until word count crosses the floor', () => {
    render(
      <GrandIdeaForm
        tenantSlug={TENANT_SLUG}
        projectId={PROJECT_ID}
        fetchImpl={okFetch()}
      />,
    );
    const textarea = screen.getByTestId('grand-idea-prompt') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'too short' } });
    const submit = screen.getByTestId('submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByTestId('word-count-error')).toBeTruthy();

    fireEvent.change(textarea, { target: { value: validPrompt } });
    expect((screen.getByTestId('submit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the success result on a 201 response and calls onCaptured', async () => {
    const onCaptured = vi.fn();
    const fetchImpl = okFetch();
    render(
      <GrandIdeaForm
        tenantSlug={TENANT_SLUG}
        projectId={PROJECT_ID}
        onCaptured={onCaptured}
        fetchImpl={fetchImpl}
      />,
    );
    const textarea = screen.getByTestId('grand-idea-prompt');
    fireEvent.change(textarea, { target: { value: validPrompt } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => {
      expect(screen.getByTestId('result-ok')).toBeTruthy();
    });
    expect(onCaptured).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('shows the error result on a non-ok response and calls onError', async () => {
    const onError = vi.fn();
    render(
      <GrandIdeaForm
        tenantSlug={TENANT_SLUG}
        projectId={PROJECT_ID}
        onError={onError}
        fetchImpl={errFetch()}
      />,
    );
    const textarea = screen.getByTestId('grand-idea-prompt');
    fireEvent.change(textarea, { target: { value: validPrompt } });
    fireEvent.click(screen.getByTestId('submit'));
    await waitFor(() => {
      expect(screen.getByTestId('result-err')).toBeTruthy();
    });
    expect(onError).toHaveBeenCalledOnce();
  });
});
