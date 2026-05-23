/**
 * Parent bridge contract tests — runs in jsdom so we have a real
 * window with a message-bus.
 *
 * Spec §10.4:
 *   - iframe boots → sends `atlas:ready` within 500ms
 *   - parent sends `atlas:select` with unknown domId → iframe replies
 *     `atlas:not-found` (does not silently swallow)
 *   - iframe sends `atlas:click` with a domId not in the manifest →
 *     parent logs warning and ignores (does not crash)
 */

import { describe, expect, it, vi } from 'vitest';
import { createBridge } from '../../../src/bridge/index.js';

function makeIframeWithWindow(): {
  iframe: HTMLIFrameElement;
  iframeWin: Window;
  sent: unknown[];
} {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const sent: unknown[] = [];
  Object.defineProperty(iframe, 'contentWindow', {
    configurable: true,
    value: {
      postMessage: (msg: unknown) => sent.push(msg),
    } as unknown as Window,
  });
  return { iframe, iframeWin: iframe.contentWindow as Window, sent };
}

describe('createBridge', () => {
  it('rejects bad options', () => {
    expect(() =>
      createBridge({
        iframe: null as unknown as HTMLIFrameElement,
        expectedOrigin: '*',
      }),
    ).toThrow();
    const iframe = document.createElement('iframe');
    expect(() => createBridge({ iframe, expectedOrigin: '' })).toThrow();
  });

  it('select() posts atlas:select with a message id', () => {
    const { iframe, sent } = makeIframeWithWindow();
    const b = createBridge({ iframe, expectedOrigin: '*' });
    const id = b.select('PG-home');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ type: 'atlas:select', domId: 'PG-home' });
    expect(id).toMatch(/^m_/);
    b.destroy();
  });

  it('clear() posts atlas:clear', () => {
    const { iframe, sent } = makeIframeWithWindow();
    const b = createBridge({ iframe, expectedOrigin: '*' });
    b.clear();
    expect(sent[0]).toMatchObject({ type: 'atlas:clear' });
    b.destroy();
  });

  it('ping() posts atlas:ping', () => {
    const { iframe, sent } = makeIframeWithWindow();
    const b = createBridge({ iframe, expectedOrigin: '*' });
    b.ping();
    expect(sent[0]).toMatchObject({ type: 'atlas:ping' });
    b.destroy();
  });

  it('route() posts atlas:route', () => {
    const { iframe, sent } = makeIframeWithWindow();
    const b = createBridge({ iframe, expectedOrigin: '*' });
    b.route('/about');
    expect(sent[0]).toMatchObject({ type: 'atlas:route', path: '/about' });
    b.destroy();
  });

  it('send() drops when contentWindow is null', () => {
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      value: null,
    });
    const b = createBridge({ iframe, expectedOrigin: '*' });
    expect(() => b.select('PG-home')).not.toThrow();
    b.destroy();
  });

  it('on() receives iframe → parent messages', () => {
    const { iframe } = makeIframeWithWindow();
    const b = createBridge({ iframe, expectedOrigin: '*' });
    const seen: unknown[] = [];
    b.on((m) => seen.push(m));
    const ev = new MessageEvent('message', {
      data: { type: 'atlas:ready', url: 'about:blank', ts: 1, protocolVersion: 1 },
      origin: '',
    });
    window.dispatchEvent(ev);
    expect(seen).toHaveLength(1);
    expect((seen[0] as { type: string }).type).toBe('atlas:ready');
    b.destroy();
  });

  it('ignores messages from wrong origin', () => {
    const { iframe } = makeIframeWithWindow();
    const onIgnored = vi.fn();
    const b = createBridge({
      iframe,
      expectedOrigin: 'https://designs.caia.app',
      onIgnored,
    });
    const seen: unknown[] = [];
    b.on((m) => seen.push(m));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'atlas:ready', url: 'about:blank', ts: 1, protocolVersion: 1 },
        origin: 'https://evil.example',
      }),
    );
    expect(seen).toHaveLength(0);
    expect(onIgnored).toHaveBeenCalledWith('origin', expect.anything());
    b.destroy();
  });

  it('ignores non-atlas-shape messages without crashing', () => {
    const { iframe } = makeIframeWithWindow();
    const onIgnored = vi.fn();
    const b = createBridge({ iframe, expectedOrigin: '*', onIgnored });
    const seen: unknown[] = [];
    b.on((m) => seen.push(m));
    window.dispatchEvent(new MessageEvent('message', { data: { foo: 'bar' } }));
    window.dispatchEvent(new MessageEvent('message', { data: 'totally not json' }));
    window.dispatchEvent(new MessageEvent('message', { data: null }));
    expect(seen).toHaveLength(0);
    expect(onIgnored).toHaveBeenCalled();
    b.destroy();
  });

  it('ignores parent→iframe-direction messages on the parent', () => {
    const { iframe } = makeIframeWithWindow();
    const onIgnored = vi.fn();
    const b = createBridge({ iframe, expectedOrigin: '*', onIgnored });
    const seen: unknown[] = [];
    b.on((m) => seen.push(m));
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'atlas:select', domId: 'X' } }),
    );
    expect(seen).toHaveLength(0);
    expect(onIgnored).toHaveBeenCalledWith('not-iframe-direction', expect.anything());
    b.destroy();
  });

  it('onType filters by message type', () => {
    const { iframe } = makeIframeWithWindow();
    const b = createBridge({ iframe, expectedOrigin: '*' });
    const clicks: unknown[] = [];
    b.onType('atlas:click', (m) => clicks.push(m));
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'atlas:ready', url: 'x', ts: 1, protocolVersion: 1 },
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'atlas:click', domId: 'X', rect: { x: 0, y: 0, w: 1, h: 1 }, ts: 1 },
      }),
    );
    expect(clicks).toHaveLength(1);
    b.destroy();
  });

  it('destroy() removes the listener', () => {
    const { iframe } = makeIframeWithWindow();
    const b = createBridge({ iframe, expectedOrigin: '*' });
    const seen: unknown[] = [];
    b.on((m) => seen.push(m));
    b.destroy();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'atlas:ready', url: 'x', ts: 1, protocolVersion: 1 },
      }),
    );
    expect(seen).toHaveLength(0);
  });
});
