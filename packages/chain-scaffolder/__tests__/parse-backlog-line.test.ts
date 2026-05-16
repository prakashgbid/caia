import { describe, it, expect } from 'vitest';
import { parseBacklogLine } from '../src/parse-backlog-line.js';

describe('parseBacklogLine', () => {
  it('parses the simple three-segment shape', () => {
    const item = parseBacklogLine('my-item :: Add foo :: Need foo for bar reasons');
    expect(item.id).toBe('my-item');
    expect(item.title).toBe('Add foo');
    expect(item.description).toBe('Need foo for bar reasons');
    expect(item.machine).toBeUndefined();
  });

  it('extracts machine= annotation', () => {
    const item = parseBacklogLine('my-item :: t :: desc with machine=m1 hint');
    expect(item.machine).toBe('m1');
  });

  it('extracts file= annotation as comma-separated paths', () => {
    const item = parseBacklogLine('my-item :: t :: desc file=src/a.ts,src/b.ts');
    expect(item.file_paths).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('throws on too few segments', () => {
    expect(() => parseBacklogLine('only :: two')).toThrowError(/three segments|got 2/);
  });

  it('ignores unknown annotations', () => {
    const item = parseBacklogLine('id :: title :: desc fnord=42');
    expect(item.description).toContain('fnord=42');
  });
});
