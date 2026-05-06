import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST, findEntryByName, listAvailable } from '../src/manifest.js';
import { shippedAgentsDir } from '../src/paths.js';

describe('manifest', () => {
  it('exposes the expected canonical CAIA agent set', () => {
    const names = listAvailable();
    // Wave 1.1 success criteria: ≥5 agents converted. We ship 10.
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toContain('caia-po');
    expect(names).toContain('caia-ba');
    expect(names).toContain('caia-ea');
    expect(names).toContain('caia-validator');
    expect(names).toContain('caia-test-design');
    expect(names).toContain('caia-coding');
    expect(names).toContain('caia-fix-it');
    expect(names).toContain('caia-steward');
    expect(names).toContain('caia-mentor');
    expect(names).toContain('caia-curator');
  });

  it('every entry has a corresponding .md file on disk', () => {
    const dir = shippedAgentsDir();
    for (const e of MANIFEST.entries) {
      const path = join(dir, e.filename);
      expect(existsSync(path), `expected ${path} to exist for ${e.name}`).toBe(true);
    }
  });

  it('every shipped .md file starts with valid YAML frontmatter', () => {
    const dir = shippedAgentsDir();
    for (const e of MANIFEST.entries) {
      const content = readFileSync(join(dir, e.filename), 'utf-8');
      expect(content.startsWith('---\n'), `${e.filename} missing frontmatter open`).toBe(true);
      expect(content.includes('\n---\n'), `${e.filename} missing frontmatter close`).toBe(true);
      // Frontmatter must include the expected `name:` matching the manifest.
      const fmEnd = content.indexOf('\n---\n', 4);
      const frontmatter = content.slice(4, fmEnd);
      expect(frontmatter).toContain(`name: ${e.name}`);
      expect(frontmatter).toContain('description:');
    }
  });

  it('manifest entries match the frontmatter `name:` of their .md files', () => {
    const dir = shippedAgentsDir();
    for (const e of MANIFEST.entries) {
      const content = readFileSync(join(dir, e.filename), 'utf-8');
      const nameLine = content.match(/^name:\s*(.+)$/m);
      expect(nameLine, `${e.filename} missing name: line`).not.toBeNull();
      expect(nameLine?.[1]?.trim()).toBe(e.name);
    }
  });

  it('every entry is at a recognised tier (2 / 3 / 4 / 5)', () => {
    for (const e of MANIFEST.entries) {
      expect([2, 3, 4, 5]).toContain(e.tier);
    }
  });

  it('every entry has at least one tool listed', () => {
    for (const e of MANIFEST.entries) {
      expect(e.tools.length).toBeGreaterThan(0);
    }
  });

  it('findEntryByName returns the matching entry', () => {
    const e = findEntryByName('caia-coding');
    expect(e).not.toBeNull();
    expect(e?.tier).toBe(4);
  });

  it('findEntryByName returns null for unknown names', () => {
    expect(findEntryByName('does-not-exist')).toBeNull();
  });

  it('manifest version is set', () => {
    expect(MANIFEST.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
