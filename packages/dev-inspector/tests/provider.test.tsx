import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

import { DevInspectorProvider } from '../src/Provider';

describe('DevInspectorProvider', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children in development', () => {
    render(
      <DevInspectorProvider>
        <div data-testid="child">hello</div>
      </DevInspectorProvider>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('shows inspect chip in development', () => {
    render(
      <DevInspectorProvider>
        <span>content</span>
      </DevInspectorProvider>
    );
    expect(screen.getByTitle('Dev Inspector (Alt+I)')).toBeInTheDocument();
  });

  it('chip starts in off state', () => {
    render(
      <DevInspectorProvider>
        <div>content</div>
      </DevInspectorProvider>
    );
    expect(screen.getByTitle('Dev Inspector (Alt+I)').textContent).toContain('○');
  });

  it('click activates inspector', () => {
    render(
      <DevInspectorProvider>
        <div>content</div>
      </DevInspectorProvider>
    );

    expect(screen.getByTitle('Dev Inspector (Alt+I)').textContent).toContain('○');
    fireEvent.click(screen.getByTitle('Dev Inspector (Alt+I)'));
    expect(screen.getByTitle('Dev Inspector (Alt+I)').textContent).toContain('◉');
  });

  it('programmatic toggle cycles active state on and off', () => {
    render(
      <DevInspectorProvider>
        <div>content</div>
      </DevInspectorProvider>
    );

    expect(screen.getByTitle('Dev Inspector (Alt+I)').textContent).toContain('○');

    act(() => { window.__devInspector!.toggle(true); });
    expect(screen.getByTitle('Dev Inspector (Alt+I)').textContent).toContain('◉');

    act(() => { window.__devInspector!.toggle(false); });
    expect(screen.getByTitle('Dev Inspector (Alt+I)').textContent).toContain('○');
  });

  it('activates via Alt+I keybind', async () => {
    const user = userEvent.setup();
    render(
      <DevInspectorProvider>
        <div>content</div>
      </DevInspectorProvider>
    );

    expect(screen.getByTitle('Dev Inspector (Alt+I)').textContent).toContain('○');

    await user.keyboard('{Alt>}i{/Alt}');
    expect(screen.getByTitle('Dev Inspector (Alt+I)').textContent).toContain('◉');
  });

  it('registers window.__devInspector API', () => {
    render(
      <DevInspectorProvider>
        <div>content</div>
      </DevInspectorProvider>
    );
    expect(window.__devInspector).toBeDefined();
    expect(typeof window.__devInspector!.find).toBe('function');
    expect(typeof window.__devInspector!.list).toBe('function');
    expect(typeof window.__devInspector!.highlight).toBe('function');
    expect(typeof window.__devInspector!.toggle).toBe('function');
  });

  it('list() returns elements with data-inspector-id', () => {
    render(
      <DevInspectorProvider>
        <div data-inspector-id="TestComp">content</div>
      </DevInspectorProvider>
    );
    const ids = window.__devInspector!.list();
    expect(ids).toContain('TestComp');
  });

  it('find() returns element by id', () => {
    render(
      <DevInspectorProvider>
        <div data-inspector-id="UniqueComp">hi</div>
      </DevInspectorProvider>
    );
    const el = window.__devInspector!.find('UniqueComp');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('data-inspector-id')).toBe('UniqueComp');
  });
});
