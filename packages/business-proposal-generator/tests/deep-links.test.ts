import { describe, expect, it } from 'vitest';

import { buildDeepLink, supportsInlinePrompt } from '../src/design-app/deep-links.js';

describe('buildDeepLink', () => {
  it('encodes prompts for claude_design', () => {
    const url = buildDeepLink('claude_design', 'hello world');
    expect(url).toBe('https://claude.ai/new?q=hello%20world');
  });
  it('encodes prompts for v0', () => {
    expect(buildDeepLink('v0', 'a b')).toBe('https://v0.dev/chat?q=a%20b');
  });
  it('encodes prompts for bolt', () => {
    expect(buildDeepLink('bolt', 'a b')).toBe('https://bolt.new/?prompt=a%20b');
  });
  it('returns the homepage URL for figma (no inline prompt support)', () => {
    expect(buildDeepLink('figma', 'x')).toBe('https://www.figma.com/files/recent');
  });
  it('returns lovable, builderio, webflow homepages without inline prompts', () => {
    expect(buildDeepLink('lovable', 'x')).toBe('https://lovable.dev/projects/new');
    expect(buildDeepLink('builderio', 'x')).toBe('https://builder.io/content/new');
    expect(buildDeepLink('webflow', 'x')).toBe('https://webflow.com/ai');
  });
});

describe('supportsInlinePrompt', () => {
  it('marks claude_design, v0, bolt as supported', () => {
    expect(supportsInlinePrompt('claude_design')).toBe(true);
    expect(supportsInlinePrompt('v0')).toBe(true);
    expect(supportsInlinePrompt('bolt')).toBe(true);
  });
  it('marks the others as not supported', () => {
    for (const t of ['figma', 'lovable', 'builderio', 'webflow'] as const) {
      expect(supportsInlinePrompt(t)).toBe(false);
    }
  });
});
