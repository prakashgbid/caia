import { describe, it, expect } from 'vitest';
import { classifyTrust } from '../src/trust.js';

describe('classifyTrust', () => {
  it('arxiv → primary', () => {
    expect(classifyTrust('https://arxiv.org/abs/2401.12345')).toBe('primary');
  });
  it('anthropic.com → primary', () => {
    expect(classifyTrust('https://www.anthropic.com/news/foo')).toBe('primary');
  });
  it('docs.* → primary', () => {
    expect(classifyTrust('https://docs.bun.sh/runtime')).toBe('primary');
    expect(classifyTrust('https://docs.langchain.com/x')).toBe('primary');
  });
  it('engineering blog → secondary', () => {
    expect(classifyTrust('https://engineering.fb.com/2024/post')).toBe('secondary');
    expect(classifyTrust('https://martinfowler.com/articles/x.html')).toBe('secondary');
  });
  it('aggregator/news → tertiary', () => {
    expect(classifyTrust('https://medium.com/@x/y')).toBe('tertiary');
    expect(classifyTrust('https://news.ycombinator.com/item?id=1')).toBe('tertiary');
    expect(classifyTrust('https://gist.github.com/foo/bar')).toBe('tertiary');
  });
  it('github repo → primary', () => {
    expect(classifyTrust('https://github.com/anthropics/claude-code')).toBe('primary');
    expect(classifyTrust('https://anthropics.github.io/claude-code')).toBe('primary');
  });
  it('unknown host → tertiary', () => {
    expect(classifyTrust('https://random-blog.example.com/post')).toBe('tertiary');
  });
  it('invalid url → tertiary', () => {
    expect(classifyTrust('not a url')).toBe('tertiary');
  });
});
