/**
 * Generate a data: URL the storybook + playwright suites can drop into
 * the iframe `src`. The HTML carries `data-atlas-id` attributes on every
 * meaningful element so the bootstrap script can find them on click.
 */

import {
  ticketTree,
  type toMapperTickets,
} from './prakash-tiwari-home.js';

import type { AtlasTicketNode } from '../src/types/index.js';

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

function renderNode(node: AtlasTicketNode, depth: number): string {
  if (!node.domId) {
    if (!Array.isArray(node.children)) return '';
    return node.children.map((c) => renderNode(c, depth)).join('');
  }
  const indent = ' '.repeat(depth * 2);
  const inner = Array.isArray(node.children)
    ? node.children.map((c) => renderNode(c, depth + 1)).join('')
    : '';
  return `${indent}<div class="atlas-fixture-node atlas-fixture-${escape(node.level)}" data-atlas-id="${escape(
    node.domId,
  )}" data-level="${escape(node.level)}" data-state="${escape(node.state)}">
${indent}  <span class="atlas-fixture-label">${escape(node.title)}</span>
${inner}
${indent}</div>
`;
}

const BOOTSTRAP_SCRIPT = `
(function () {
  if (window.__atlasFixtureBridge) return;
  window.__atlasFixtureBridge = true;
  function rect(el) {
    var r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }
  function nearest(node) {
    while (node && node !== document) {
      if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-atlas-id')) return node;
      node = node.parentNode;
    }
    return null;
  }
  document.addEventListener('click', function (e) {
    var el = nearest(e.target);
    if (!el) return;
    parent.postMessage({
      type: 'atlas:click',
      domId: el.getAttribute('data-atlas-id'),
      rect: rect(el),
      ts: performance.now(),
      modifiers: { shift: !!e.shiftKey, meta: !!e.metaKey, ctrl: !!e.ctrlKey }
    }, '*');
  }, true);
  document.addEventListener('pointermove', function (e) {
    if (window.__atlasHoverTimer) clearTimeout(window.__atlasHoverTimer);
    window.__atlasHoverTimer = setTimeout(function () {
      var el = nearest(e.target);
      var id = el ? el.getAttribute('data-atlas-id') : null;
      parent.postMessage({
        type: 'atlas:hover',
        domId: id,
        rect: el ? rect(el) : null,
        ts: performance.now()
      }, '*');
    }, 80);
  }, true);
  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || typeof data.type !== 'string') return;
    if (data.type === 'atlas:select') {
      var domId = data.domId;
      var safe = (window.CSS && window.CSS.escape) ? window.CSS.escape(domId) : domId;
      var el = document.querySelector('[data-atlas-id="' + safe + '"]');
      if (!el) {
        parent.postMessage({ type: 'atlas:not-found', domId: domId, ts: performance.now(), replyTo: data.messageId }, '*');
        return;
      }
      parent.postMessage({ type: 'atlas:rect', domId: domId, rect: rect(el), ts: performance.now(), replyTo: data.messageId }, '*');
    } else if (data.type === 'atlas:ping') {
      parent.postMessage({ type: 'atlas:pong', ts: performance.now(), replyTo: data.messageId }, '*');
    }
  });
  function emitReady() {
    parent.postMessage({ type: 'atlas:ready', url: location.href, ts: performance.now(), protocolVersion: 1 }, '*');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', emitReady, { once: true });
  } else {
    queueMicrotask(emitReady);
  }
})();
`.trim();

const STYLE_BLOCK = `
  body { margin: 0; font-family: -apple-system, sans-serif; padding: 16px; color: #111; background: #fff; }
  .atlas-fixture-node { border: 1px solid #d6d6d6; padding: 12px; margin: 8px 0; border-radius: 6px; }
  .atlas-fixture-page { border-color: #888; background: #fafafa; }
  .atlas-fixture-section { border-color: #5b8def; background: #f3f6ff; }
  .atlas-fixture-widget { border-color: #f59e0b; background: #fffbeb; }
  .atlas-fixture-story { border-color: #10b981; background: #f0fdf4; }
  .atlas-fixture-label { font-weight: 600; display: block; margin-bottom: 6px; }
`.trim();

export function buildFixtureHtml(): string {
  const root = ticketTree.tree;
  const body = renderNode(root, 0);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Atlas fixture</title>
<style>${STYLE_BLOCK}</style>
</head>
<body>
${body}
<script>${BOOTSTRAP_SCRIPT}</script>
</body>
</html>`;
}

/** A data:URL form (Storybook fits this into iframe src). */
export function buildFixtureDataUrl(): string {
  const html = buildFixtureHtml();
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

// Avoid an unused-import lint when consumers only use buildFixtureHtml.
export type _UnusedToMapperTickets = typeof toMapperTickets;
