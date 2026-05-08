import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';

import { defaultFsReader } from '../src/fs-reader.js';
import { loadMemoryFiles, parseMemoryFile } from '../src/memory-loader.js';

const MEMORY_DIR = resolve(__dirname, '__fixtures__/memory');

describe('loadMemoryFiles', () => {
  it('walks the fixture directory and returns refs', () => {
    const refs = loadMemoryFiles(defaultFsReader, MEMORY_DIR);
    expect(refs.length).toBeGreaterThanOrEqual(2);
    const filenames = refs.map(r => r.filename);
    expect(filenames).toContain('feedback_no_api_key_billing.md');
    expect(filenames).toContain('feedback_pr_update_branch_rebase.md');
  });

  it('returns [] when memoryRoot does not exist', () => {
    expect(loadMemoryFiles(defaultFsReader, '/nope/missing')).toEqual([]);
  });

  it('extracts the topic from frontmatter name field', () => {
    const refs = loadMemoryFiles(defaultFsReader, MEMORY_DIR);
    const billing = refs.find(r => r.filename === 'feedback_no_api_key_billing.md');
    expect(billing?.topic).toMatch(/Subscription-only LLM/);
  });
});

describe('parseMemoryFile', () => {
  it('falls back to filename-derived topic when no frontmatter', () => {
    const ref = parseMemoryFile('feedback_some_topic_here.md', '# No frontmatter\nbody');
    expect(ref?.topic).toMatch(/some topic here/);
  });

  it('keeps body excerpt under 500 chars', () => {
    const big = 'x'.repeat(2000);
    const ref = parseMemoryFile('feedback_big.md', `---\nname: big\n---\n${big}`);
    expect(ref?.bodyExcerpt.length).toBeLessThanOrEqual(500);
  });
});
