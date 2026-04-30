/**
 * Settings-file write deny-list — CurXecute (CVE-2025-54135) mitigation.
 */

import { describe, it, expect } from 'vitest';
import {
  ForbiddenSettingsPathError,
  assertSettingsPathNotForbidden,
  isForbiddenSettingsPath,
} from '../src/index.js';

describe('isForbiddenSettingsPath', () => {
  it('flags any mcp.json under any tree', () => {
    expect(isForbiddenSettingsPath('mcp.json')).toBeTruthy();
    expect(isForbiddenSettingsPath('/Users/MAC/projects/x/mcp.json')).toBeTruthy();
    expect(isForbiddenSettingsPath('./repo/.mcp.json')).toBeTruthy();
    expect(isForbiddenSettingsPath('./repo/.cursor/mcp.json')).toBeTruthy();
    expect(isForbiddenSettingsPath('foo/bar/.continue/config.json')).toBeTruthy();
    expect(isForbiddenSettingsPath('foo/.vscode/settings.json')).toBeTruthy();
  });
  it('flags Claude Desktop config explicitly', () => {
    expect(
      isForbiddenSettingsPath(
        '/Users/MAC/Library/Application Support/Claude/claude_desktop_config.json',
      ),
    ).toBeTruthy();
    expect(
      isForbiddenSettingsPath('/Users/MAC/.config/claude/claude_desktop_config.json'),
    ).toBeTruthy();
  });
  it('does NOT flag .claude/settings.json (reserved for additive-merge)', () => {
    expect(isForbiddenSettingsPath('.claude/settings.json')).toBeNull();
    expect(
      isForbiddenSettingsPath('/Users/MAC/.claude/settings.json'),
    ).toBeNull();
  });
  it('does NOT flag unrelated configs', () => {
    expect(isForbiddenSettingsPath('package.json')).toBeNull();
    expect(isForbiddenSettingsPath('foo/bar/tsconfig.json')).toBeNull();
    expect(isForbiddenSettingsPath('configs/eslint.json')).toBeNull();
  });
});

describe('assertSettingsPathNotForbidden', () => {
  it('throws for forbidden paths', () => {
    expect(() =>
      assertSettingsPathNotForbidden('/repo/.mcp.json'),
    ).toThrow(ForbiddenSettingsPathError);
  });
  it('passes for safe paths', () => {
    expect(() => assertSettingsPathNotForbidden('src/index.ts')).not.toThrow();
    expect(() =>
      assertSettingsPathNotForbidden('.claude/settings.json'),
    ).not.toThrow();
  });
});
