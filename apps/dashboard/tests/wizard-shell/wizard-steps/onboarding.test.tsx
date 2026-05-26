/**
 * @vitest-environment jsdom
 *
 * Unit tests for the Step 1 onboarding stepper UI. We exercise the
 * `OnboardingStepForm` directly with synthetic category data — the
 * page-level Server Component (`app/wizard/onboarding/page.tsx`) is a
 * one-line thin wrapper that mounts this form, so testing the form
 * covers the visible behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  OnboardingStepForm,
  type OnboardingStepFormCategory,
} from '../../../components/wizard/OnboardingStepForm';

const CAT_IDENTITY: OnboardingStepFormCategory = {
  id: 'identity',
  label: 'Identity',
  ordinal: 1,
  required: true,
  description: 'Tell us about your company.',
  providers: [
    {
      id: 'manual',
      label: 'Manual',
      archetype: 'endpoint',
      noCredentials: false,
      credentialDescriptors: [
        { keyId: 'company_name', archetype: 'endpoint', scopesRequired: [], storeSecret: false },
      ],
    },
  ],
};

const CAT_DOCS: OnboardingStepFormCategory = {
  id: 'docs',
  label: 'Docs',
  ordinal: 2,
  required: false,
  description: 'Optional docs provider.',
  providers: [
    {
      id: 'notion',
      label: 'Notion',
      archetype: 'oauth',
      noCredentials: false,
      credentialDescriptors: [
        { keyId: 'notion_token', archetype: 'api_token', scopesRequired: [], storeSecret: true },
      ],
    },
    { id: 'none', label: 'None', archetype: 'endpoint', noCredentials: true, credentialDescriptors: [] },
  ],
};

afterEach(() => cleanup());

describe('<OnboardingStepForm>', () => {
  it('renders the first category as the active step', () => {
    render(
      <OnboardingStepForm projectId="p-1" categories={[CAT_IDENTITY, CAT_DOCS]} />,
    );
    expect(screen.getByTestId('onboarding-category-identity')).toBeTruthy();
  });

  it('shows a `required` badge for mandatory categories', () => {
    render(<OnboardingStepForm projectId="p-1" categories={[CAT_IDENTITY]} />);
    expect(screen.getByTestId('required-badge').textContent).toBe('required');
  });

  it('shows an `optional` badge for optional categories', () => {
    render(<OnboardingStepForm projectId="p-1" categories={[CAT_DOCS]} />);
    expect(screen.getByTestId('required-badge').textContent).toBe('optional');
  });

  it('refuses to advance without a provider pick', () => {
    render(<OnboardingStepForm projectId="p-1" categories={[CAT_IDENTITY]} />);
    fireEvent.click(screen.getByTestId('submit-step'));
    expect(screen.getByTestId('step-error').textContent).toContain('provider');
  });

  it('refuses to advance without credentials when descriptors require them', () => {
    render(<OnboardingStepForm projectId="p-1" categories={[CAT_IDENTITY]} />);
    fireEvent.click(screen.getByTestId('provider-manual'));
    fireEvent.click(screen.getByTestId('submit-step'));
    expect(screen.getByTestId('step-error').textContent).toContain('credential');
  });

  it('advances after provider + credential are provided', () => {
    render(
      <OnboardingStepForm projectId="p-1" categories={[CAT_IDENTITY, CAT_DOCS]} />,
    );
    fireEvent.click(screen.getByTestId('provider-manual'));
    fireEvent.change(screen.getByTestId('cred-company_name'), {
      target: { value: 'Acme Inc.' },
    });
    fireEvent.click(screen.getByTestId('submit-step'));
    expect(screen.getByTestId('onboarding-category-docs')).toBeTruthy();
  });

  it('refuses to defer a required category', () => {
    render(<OnboardingStepForm projectId="p-1" categories={[CAT_IDENTITY, CAT_DOCS]} />);
    const defer = screen.getByTestId('defer-step') as HTMLButtonElement;
    expect(defer.disabled).toBe(true);
  });

  it('defers optional categories cleanly', () => {
    render(<OnboardingStepForm projectId="p-1" categories={[CAT_DOCS]} />);
    fireEvent.click(screen.getByTestId('defer-step'));
    // single category — defer advances to "empty" state still showing the step
    // but the FSM CTA should NOT enable because there's only one optional cat.
    const fsmBtn = screen.getByTestId('advance-fsm') as HTMLButtonElement;
    expect(fsmBtn.disabled).toBe(false);
  });

  it('disables the FSM advance button until mandatory categories are done', () => {
    render(
      <OnboardingStepForm projectId="p-1" categories={[CAT_IDENTITY, CAT_DOCS]} />,
    );
    const btn = screen.getByTestId('advance-fsm') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables the FSM advance button once every mandatory category is passed/deferred', () => {
    render(
      <OnboardingStepForm projectId="p-1" categories={[CAT_IDENTITY, CAT_DOCS]} />,
    );
    fireEvent.click(screen.getByTestId('provider-manual'));
    fireEvent.change(screen.getByTestId('cred-company_name'), {
      target: { value: 'Acme Inc.' },
    });
    fireEvent.click(screen.getByTestId('submit-step'));
    const btn = screen.getByTestId('advance-fsm') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('PATCHes the wizard state route on FSM advance', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ state: 'idea-captured' }), { status: 200 }),
    );
    render(
      <OnboardingStepForm
        projectId="p-42"
        categories={[CAT_IDENTITY]}
        fetchImpl={fetchSpy as unknown as typeof fetch}
      />,
    );
    fireEvent.click(screen.getByTestId('provider-manual'));
    fireEvent.change(screen.getByTestId('cred-company_name'), {
      target: { value: 'Acme' },
    });
    fireEvent.click(screen.getByTestId('submit-step'));
    fireEvent.click(screen.getByTestId('advance-fsm'));
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/wizard/p-42/state');
    const body = JSON.parse((fetchSpy.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body.targetState).toBe('idea-captured');
  });

  it('surfaces an error when the FSM PATCH fails', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: 'invalid-transition' }), { status: 409 }),
    );
    render(
      <OnboardingStepForm
        projectId="p-1"
        categories={[CAT_IDENTITY]}
        fetchImpl={fetchSpy as unknown as typeof fetch}
      />,
    );
    fireEvent.click(screen.getByTestId('provider-manual'));
    fireEvent.change(screen.getByTestId('cred-company_name'), {
      target: { value: 'Acme' },
    });
    fireEvent.click(screen.getByTestId('submit-step'));
    fireEvent.click(screen.getByTestId('advance-fsm'));
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByTestId('advance-error').textContent).toContain('invalid-transition');
  });

  it('renders an empty-state card when given zero categories', () => {
    render(<OnboardingStepForm projectId="p-1" categories={[]} />);
    expect(screen.getByTestId('onboarding-empty')).toBeTruthy();
  });
});
