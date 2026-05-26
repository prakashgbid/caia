/**
 * ContactForm validation + submission behaviour.
 *
 * Stubs `global.fetch` so the test can assert the request shape and the
 * resulting UI state transitions (idle → submitting → success).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContactForm } from '../components/contact-form';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ContactForm', () => {
  it('blocks submission with invalid email', async () => {
    render(<ContactForm />);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'Op' } });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.change(screen.getByLabelText(/how can we help/i), {
      target: { value: 'short' },
    });
    fireEvent.submit(screen.getByTestId('contact-submit').closest('form')!);
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
  });

  it('POSTs valid payload to /api/contact and shows success state', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    render(<ContactForm />);
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: 'Operator Person' },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'op@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/how can we help/i), {
      target: {
        value: 'I would like to chat about onboarding our team to ChiefAIA.',
      },
    });
    fireEvent.submit(screen.getByTestId('contact-submit').closest('form')!);

    await waitFor(() => {
      expect(screen.getByTestId('contact-success')).toBeInTheDocument();
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/contact');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse(((init as RequestInit).body as string) ?? '{}');
    expect(body.email).toBe('op@example.com');
  });
});
