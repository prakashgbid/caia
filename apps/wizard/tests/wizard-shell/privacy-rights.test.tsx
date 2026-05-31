/**
 * @vitest-environment jsdom
 *
 * Unit tests for the B8 GDPR rights surface — both the
 * `<PrivacyRightsPanel>` client component and the two API route
 * handlers (export + erase).
 *
 * 18 cases covering:
 *   - panel rendering (3)
 *   - export flow (3)
 *   - erase dialog open + confirm-word gating (4)
 *   - erase POST (2)
 *   - export route (3)
 *   - erase route (3)
 *
 * Brief asked for >=15. Playwright E2E for the export flow lives in
 * `tests/wizard-shell/privacy-export.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PrivacyRightsPanel } from '../../components/wizard/PrivacyRightsPanel';

vi.mock('next/headers', () => ({
  headers: async () => ({
    get(name: string) {
      if (name === 'x-tenant-id') return 'tenant-test';
      return null;
    },
  }),
}));

afterEach(() => cleanup());

const realEnv = { ...process.env };
beforeEach(() => {
  delete process.env['WIZARD_PRIVACY_ERASE_LIVE'];
});
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in realEnv)) delete process.env[k];
  }
  for (const k of Object.keys(realEnv)) {
    process.env[k] = realEnv[k]!;
  }
});

function okFetch(body: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

function failFetch(status = 500, body: unknown = { error: 'boom' }) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

// ─── Panel rendering ───────────────────────────────────────────────────

describe('<PrivacyRightsPanel> rendering', () => {
  it('renders the Article 15 export card with a primary button', () => {
    render(<PrivacyRightsPanel />);
    expect(screen.getByTestId('privacy-export-card')).toBeTruthy();
    expect(screen.getByTestId('privacy-export-button').textContent).toBe(
      'Export my data',
    );
  });

  it('renders the Article 17 erase card with a destructive button', () => {
    render(<PrivacyRightsPanel />);
    expect(screen.getByTestId('privacy-erase-card')).toBeTruthy();
    expect(screen.getByTestId('privacy-erase-open-dialog')).toBeTruthy();
  });

  it('does not show the erase dialog by default', () => {
    render(<PrivacyRightsPanel />);
    expect(screen.queryByTestId('privacy-erase-dialog')).toBeNull();
  });
});

// ─── Export flow ───────────────────────────────────────────────────────

describe('<PrivacyRightsPanel> export flow', () => {
  it('POSTs to /api/settings/privacy/export and downloads the response', async () => {
    const fetchImpl = okFetch({ schema_version: '1', tenant_id: 't-1' });
    const downloadImpl = vi.fn();
    render(
      <PrivacyRightsPanel fetchImpl={fetchImpl} downloadImpl={downloadImpl} />,
    );
    fireEvent.click(screen.getByTestId('privacy-export-button'));
    await waitFor(() => {
      expect(downloadImpl).toHaveBeenCalledTimes(1);
    });
    const [url] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/settings/privacy/export');
    const [filename, content] = downloadImpl.mock.calls[0] as [string, string];
    expect(filename.startsWith('caia-tenant-export-')).toBe(true);
    expect(filename.endsWith('.json')).toBe(true);
    expect(content).toContain('schema_version');
  });

  it('renders a success message after a successful export', async () => {
    const fetchImpl = okFetch({ ok: true });
    const downloadImpl = vi.fn();
    render(
      <PrivacyRightsPanel fetchImpl={fetchImpl} downloadImpl={downloadImpl} />,
    );
    fireEvent.click(screen.getByTestId('privacy-export-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('privacy-export-message')).not.toBeNull();
    });
    expect(screen.getByTestId('privacy-export-message').textContent).toContain(
      'Export ready',
    );
  });

  it('renders an error message when the export route fails', async () => {
    const fetchImpl = failFetch(500, { error: 'pg-down' });
    const downloadImpl = vi.fn();
    render(
      <PrivacyRightsPanel fetchImpl={fetchImpl} downloadImpl={downloadImpl} />,
    );
    fireEvent.click(screen.getByTestId('privacy-export-button'));
    await waitFor(() => {
      expect(screen.queryByTestId('privacy-export-error')).not.toBeNull();
    });
    expect(screen.getByTestId('privacy-export-error').textContent).toContain(
      'pg-down',
    );
    expect(downloadImpl).not.toHaveBeenCalled();
  });
});

// ─── Erase dialog ──────────────────────────────────────────────────────

describe('<PrivacyRightsPanel> erase dialog', () => {
  it('opens the dialog on Delete-my-data click', () => {
    render(<PrivacyRightsPanel />);
    fireEvent.click(screen.getByTestId('privacy-erase-open-dialog'));
    expect(screen.getByTestId('privacy-erase-dialog')).toBeTruthy();
    expect(screen.getByTestId('privacy-erase-confirm-input')).toBeTruthy();
  });

  it('refuses to erase when confirmation word is wrong', async () => {
    const fetchImpl = okFetch({ ok: true });
    render(<PrivacyRightsPanel fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByTestId('privacy-erase-open-dialog'));
    fireEvent.change(screen.getByTestId('privacy-erase-confirm-input'), {
      target: { value: 'erase' }, // wrong case
    });
    fireEvent.click(screen.getByTestId('privacy-erase-confirm'));
    await waitFor(() => {
      expect(screen.queryByTestId('privacy-erase-error')).not.toBeNull();
    });
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(0);
  });

  it('closes the dialog on Cancel without erasing', async () => {
    const fetchImpl = okFetch({ ok: true });
    render(<PrivacyRightsPanel fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByTestId('privacy-erase-open-dialog'));
    fireEvent.click(screen.getByTestId('privacy-erase-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('privacy-erase-dialog')).toBeNull();
    });
    expect(
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(0);
  });

  it('keeps the dialog open when confirmation word is wrong (no submit)', () => {
    render(<PrivacyRightsPanel />);
    fireEvent.click(screen.getByTestId('privacy-erase-open-dialog'));
    fireEvent.change(screen.getByTestId('privacy-erase-confirm-input'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByTestId('privacy-erase-confirm'));
    expect(screen.getByTestId('privacy-erase-dialog')).toBeTruthy();
  });
});

// ─── Erase POST ────────────────────────────────────────────────────────

describe('<PrivacyRightsPanel> erase POST', () => {
  it('POSTs the confirmation word to /api/settings/privacy/erase', async () => {
    const fetchImpl = okFetch({ ok: true, tenant_id: 'tenant-test' });
    render(<PrivacyRightsPanel fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByTestId('privacy-erase-open-dialog'));
    fireEvent.change(screen.getByTestId('privacy-erase-confirm-input'), {
      target: { value: 'ERASE' },
    });
    fireEvent.click(screen.getByTestId('privacy-erase-confirm'));
    await waitFor(() => {
      expect(
        (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBe(1);
    });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toBe('/api/settings/privacy/erase');
    const body = JSON.parse(init.body as string) as { confirmation: string };
    expect(body.confirmation).toBe('ERASE');
  });

  it('surfaces the erase-route error in the dialog body', async () => {
    const fetchImpl = failFetch(500, { error: 'erase-failed' });
    render(<PrivacyRightsPanel fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByTestId('privacy-erase-open-dialog'));
    fireEvent.change(screen.getByTestId('privacy-erase-confirm-input'), {
      target: { value: 'ERASE' },
    });
    fireEvent.click(screen.getByTestId('privacy-erase-confirm'));
    await waitFor(() => {
      expect(screen.queryByTestId('privacy-erase-error')).not.toBeNull();
    });
    expect(screen.getByTestId('privacy-erase-error').textContent).toContain(
      'erase-failed',
    );
  });
});

// ─── Route: export ─────────────────────────────────────────────────────

describe('POST /api/settings/privacy/export', () => {
  it('returns 401 without x-tenant-id', async () => {
    vi.resetModules();
    vi.doMock('next/headers', () => ({
      headers: async () => ({ get: () => null }),
    }));
    const mod = await import('../../app/api/settings/privacy/export/route');
    const res = await mod.POST(
      new Request('http://l/api/settings/privacy/export', {
        method: 'POST',
        body: JSON.stringify({}),
      }) as never,
    );
    expect(res.status).toBe(401);
    vi.doUnmock('next/headers');
    vi.resetModules();
    vi.doMock('next/headers', () => ({
      headers: async () => ({
        get(name: string) {
          if (name === 'x-tenant-id') return 'tenant-test';
          return null;
        },
      }),
    }));
  });

  it('returns a JSON envelope with schema_version=1 and tenant_id', async () => {
    const mod = await import('../../app/api/settings/privacy/export/route');
    const res = await mod.POST(
      new Request('http://l/api/settings/privacy/export', {
        method: 'POST',
        body: JSON.stringify({}),
      }) as never,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    const env = JSON.parse(text) as {
      schema_version: string;
      tenant_id: string;
    };
    expect(env.schema_version).toBe('1');
    expect(env.tenant_id).toBe('tenant-test');
  });

  it('sets a content-disposition header with the tenant id in the filename', async () => {
    const mod = await import('../../app/api/settings/privacy/export/route');
    const res = await mod.POST(
      new Request('http://l/api/settings/privacy/export', {
        method: 'POST',
        body: JSON.stringify({}),
      }) as never,
    );
    const cd = res.headers.get('content-disposition');
    expect(cd).toContain('caia-tenant-export-tenant-test');
  });
});

// ─── Route: erase ──────────────────────────────────────────────────────

describe('POST /api/settings/privacy/erase', () => {
  it('returns 400 when confirmation is missing', async () => {
    const mod = await import('../../app/api/settings/privacy/erase/route');
    const res = await mod.POST(
      new Request('http://l/api/settings/privacy/erase', {
        method: 'POST',
        body: JSON.stringify({}),
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('confirmation-required');
  });

  it('returns 200 + source=memory + cascade=all-true on the stub path', async () => {
    const mod = await import('../../app/api/settings/privacy/erase/route');
    const res = await mod.POST(
      new Request('http://l/api/settings/privacy/erase', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'ERASE' }),
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      source: string;
      cascade: Record<string, boolean>;
    };
    expect(body.ok).toBe(true);
    expect(body.source).toBe('memory');
    for (const v of Object.values(body.cascade)) {
      expect(v).toBe(true);
    }
  });

  it('rejects whitespace-padded wrong confirmation', async () => {
    const mod = await import('../../app/api/settings/privacy/erase/route');
    const res = await mod.POST(
      new Request('http://l/api/settings/privacy/erase', {
        method: 'POST',
        body: JSON.stringify({ confirmation: '   erase   ' }),
      }) as never,
    );
    expect(res.status).toBe(400);
  });
});
