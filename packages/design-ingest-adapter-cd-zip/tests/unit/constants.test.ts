import { describe, expect, it } from 'vitest';
import { IGNORE_FILES, REQUIRED_FILES, REQUIRED_PAGE_PATTERN } from '../../src/constants.js';

describe('CD ZIP constants', () => {
  it('IGNORE_FILES contains the 8 spec entries', () => {
    expect(IGNORE_FILES).toHaveLength(8);
    expect(IGNORE_FILES).toContain('design-canvas.jsx');
    expect(IGNORE_FILES).toContain('style-guide.jsx');
  });

  it('REQUIRED_FILES contains README and styles.css', () => {
    expect(REQUIRED_FILES).toContain('README.md');
    expect(REQUIRED_FILES).toContain('project/styles.css');
  });

  it('REQUIRED_PAGE_PATTERN matches a jsx file under project/pages', () => {
    expect(REQUIRED_PAGE_PATTERN.test('project/pages/home.jsx')).toBe(true);
    expect(REQUIRED_PAGE_PATTERN.test('project/pages/sub/dir/x.jsx')).toBe(false);
    expect(REQUIRED_PAGE_PATTERN.test('project/home.jsx')).toBe(false);
  });
});
