/**
 * Wire-protocol guard tests — `isAtlasMessage`, narrowers.
 */

import { describe, expect, it } from 'vitest';
import {
  ATLAS_PROTOCOL_VERSION,
  isAtlasMessage,
  isIframeMessage,
  isParentMessage,
  type AtlasClickMessage,
  type AtlasSelectMessage,
} from '../../../src/bridge/index.js';

describe('bridge/protocol guards', () => {
  it('isAtlasMessage rejects non-objects', () => {
    expect(isAtlasMessage(null)).toBe(false);
    expect(isAtlasMessage(undefined)).toBe(false);
    expect(isAtlasMessage('atlas:select')).toBe(false);
    expect(isAtlasMessage(123)).toBe(false);
  });

  it('isAtlasMessage rejects objects with non-atlas type', () => {
    expect(isAtlasMessage({ type: 'foo' })).toBe(false);
    expect(isAtlasMessage({ type: 42 })).toBe(false);
    expect(isAtlasMessage({})).toBe(false);
  });

  it('isAtlasMessage accepts any atlas:* type', () => {
    expect(isAtlasMessage({ type: 'atlas:ready' })).toBe(true);
    expect(isAtlasMessage({ type: 'atlas:unknown' })).toBe(true);
  });

  it('narrows correctly with isParentMessage and isIframeMessage', () => {
    const sel: AtlasSelectMessage = { type: 'atlas:select', domId: 'PG-home' };
    const click: AtlasClickMessage = {
      type: 'atlas:click',
      domId: 'PG-home',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      ts: 1,
    };
    expect(isParentMessage(sel)).toBe(true);
    expect(isIframeMessage(sel)).toBe(false);
    expect(isParentMessage(click)).toBe(false);
    expect(isIframeMessage(click)).toBe(true);
  });

  it('protocol version is the literal 1', () => {
    expect(ATLAS_PROTOCOL_VERSION).toBe(1);
  });
});
