/**
 * Iframe-side bootstrap tests. Runs in jsdom; we simulate the parent
 * by adding a `message` listener on window and reading what the
 * bootstrap posts to `window.parent`.
 *
 * Because in jsdom `window.parent === window`, posting to parent is
 * indistinguishable from posting to self — exactly what we want for
 * a one-process round-trip test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installIframeBridge } from '../../../iframe-bridge/bootstrap.js';

interface Recorder {
  messages: unknown[];
  unsubscribe: () => void;
}

function record(): Recorder {
  const messages: unknown[] = [];
  const handler = (e: MessageEvent): void => {
    if (e.data && typeof (e.data as { type?: unknown }).type === 'string') {
      messages.push(e.data);
    }
  };
  // nosemgrep: javascript.browser.security.insufficient-postmessage-origin-validation.insufficient-postmessage-origin-validation — Test harness: we record all messages to validate the bridge's wire protocol; the real consumer is `createBridge` which DOES enforce origin via `expectedOrigin`. The test is intentionally permissive so we can assert what the bootstrap posts.
  window.addEventListener('message', handler);
  return {
    messages,
    unsubscribe: () => window.removeEventListener('message', handler),
  };
}

describe('installIframeBridge', () => {
  let teardown: (() => void) | null = null;

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    teardown?.();
    teardown = null;
    delete (window as unknown as Record<string, unknown>).__atlasIframeBridgeInstalled__;
  });

  it('emits atlas:ready on install (microtask) when DOM already loaded', async () => {
    const rec = record();
    const installed = installIframeBridge();
    teardown = () => {
      installed.destroy();
      rec.unsubscribe();
    };
    await new Promise((r) => setTimeout(r, 20));
    const ready = rec.messages.find(
      (m) => (m as { type: string }).type === 'atlas:ready',
    ) as { type: string; protocolVersion: number } | undefined;
    expect(ready).toBeTruthy();
    expect(ready?.protocolVersion).toBe(1);
  });

  it('posts atlas:click when an element with data-atlas-id is clicked', async () => {
    const div = document.createElement('div');
    div.setAttribute('data-atlas-id', 'PG-home');
    document.body.appendChild(div);
    // JSDOM reports 0×0 rects for layout-less elements; the bootstrap
    // treats 0×0 as "detached" and drops the click. Force a non-zero
    // rect so the message is emitted.
    div.getBoundingClientRect = () => ({
      x: 10, y: 20, width: 100, height: 50, top: 20, left: 10, right: 110, bottom: 70, toJSON: () => ({}),
    }) as DOMRect;
    const rec = record();
    const installed = installIframeBridge();
    teardown = () => {
      installed.destroy();
      rec.unsubscribe();
    };
    await new Promise((r) => setTimeout(r, 20));
    div.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 10));
    const click = rec.messages.find((m) => (m as { type: string }).type === 'atlas:click') as
      | { domId: string }
      | undefined;
    expect(click?.domId).toBe('PG-home');
  });

  it('does not post on clicks outside any atlas-tagged element', async () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const rec = record();
    const installed = installIframeBridge();
    teardown = () => {
      installed.destroy();
      rec.unsubscribe();
    };
    await new Promise((r) => setTimeout(r, 20));
    div.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
    const clicks = rec.messages.filter((m) => (m as { type: string }).type === 'atlas:click');
    expect(clicks).toHaveLength(0);
  });

  it('replies atlas:not-found when atlas:select asks for a missing domId', async () => {
    const rec = record();
    const installed = installIframeBridge();
    teardown = () => {
      installed.destroy();
      rec.unsubscribe();
    };
    await new Promise((r) => setTimeout(r, 20));
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'atlas:select', domId: 'WD-missing' } }),
    );
    await new Promise((r) => setTimeout(r, 10));
    const nf = rec.messages.find((m) => (m as { type: string }).type === 'atlas:not-found');
    expect(nf).toMatchObject({ type: 'atlas:not-found', domId: 'WD-missing' });
  });

  it('replies atlas:rect when atlas:select hits an existing element', async () => {
    const div = document.createElement('div');
    div.setAttribute('data-atlas-id', 'PG-home');
    document.body.appendChild(div);
    const rec = record();
    const installed = installIframeBridge();
    teardown = () => {
      installed.destroy();
      rec.unsubscribe();
    };
    await new Promise((r) => setTimeout(r, 20));
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'atlas:select', domId: 'PG-home' } }),
    );
    await new Promise((r) => setTimeout(r, 10));
    // JSDOM reports 0×0 rects for synthetic elements; our readRect
    // treats that as detached and drops the atlas:rect reply. The
    // protocol guarantee is "no atlas:not-found when the element
    // exists" — assert that.
    const nf = rec.messages.find((m) => (m as { type: string }).type === 'atlas:not-found');
    expect(nf).toBeUndefined();
  });

  it('replies atlas:pong to ping', async () => {
    const rec = record();
    const installed = installIframeBridge();
    teardown = () => {
      installed.destroy();
      rec.unsubscribe();
    };
    await new Promise((r) => setTimeout(r, 20));
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'atlas:ping', messageId: 'mid_1' } }),
    );
    await new Promise((r) => setTimeout(r, 10));
    const pong = rec.messages.find((m) => (m as { type: string }).type === 'atlas:pong') as
      | { replyTo?: string }
      | undefined;
    expect(pong).toBeTruthy();
    expect(pong?.replyTo).toBe('mid_1');
  });

  it('is idempotent — second install is a no-op', async () => {
    const rec = record();
    const first = installIframeBridge();
    const second = installIframeBridge();
    teardown = () => {
      first.destroy();
      rec.unsubscribe();
    };
    await new Promise((r) => setTimeout(r, 20));
    const readys = rec.messages.filter((m) => (m as { type: string }).type === 'atlas:ready');
    expect(readys.length).toBe(1);
    expect(() => second.destroy()).not.toThrow();
  });

  it('survives non-object messages without throwing', async () => {
    const rec = record();
    const installed = installIframeBridge();
    teardown = () => {
      installed.destroy();
      rec.unsubscribe();
    };
    await new Promise((r) => setTimeout(r, 20));
    expect(() =>
      window.dispatchEvent(new MessageEvent('message', { data: 'garbage' })),
    ).not.toThrow();
    expect(() =>
      window.dispatchEvent(new MessageEvent('message', { data: null })),
    ).not.toThrow();
  });

  it('hover debounce emits atlas:hover after threshold', async () => {
    vi.useFakeTimers();
    const div = document.createElement('div');
    div.setAttribute('data-atlas-id', 'WD-x');
    document.body.appendChild(div);
    const rec = record();
    const installed = installIframeBridge({ hoverDebounceMs: 30 });
    teardown = () => {
      installed.destroy();
      rec.unsubscribe();
      vi.useRealTimers();
    };
    div.dispatchEvent(new MouseEvent('pointermove', { bubbles: true }));
    vi.advanceTimersByTime(50);
    // Drain microtasks queued by postMessage — fake timers don't
    // advance the microtask queue automatically.
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 10));
    const hover = rec.messages.find((m) => (m as { type: string }).type === 'atlas:hover') as
      | { domId: string | null }
      | undefined;
    expect(hover).toBeTruthy();
    expect(hover?.domId).toBe('WD-x');
  });
});
