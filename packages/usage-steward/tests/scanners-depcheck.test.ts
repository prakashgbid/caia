import { describe, expect, it } from 'vitest';
import { parseDepcheckJson, runDepcheck } from '../src/scanners/depcheck.js';

describe('parseDepcheckJson', () => {
  it('returns [] for empty stdout', () => {
    expect(parseDepcheckJson('', '/tmp/pkg')).toEqual([]);
  });
  it('returns [] when no JSON object found', () => {
    expect(parseDepcheckJson('plain text', '/tmp/pkg')).toEqual([]);
  });
  it('parses unused dependencies as error severity', () => {
    const json = JSON.stringify({ dependencies: ['lodash', 'jquery'] });
    const out = parseDepcheckJson(json, '/tmp/pkg');
    expect(out).toHaveLength(2);
    for (const f of out) {
      expect(f.kind).toBe('unused-dependency');
      expect(f.severity).toBe('error');
    }
  });
  it('parses unused devDependencies as info severity', () => {
    const json = JSON.stringify({ devDependencies: ['prettier'] });
    const out = parseDepcheckJson(json, '/tmp/pkg');
    expect(out[0]?.severity).toBe('info');
  });
  it('parses missing-in-package-json with absolute file paths', () => {
    const json = JSON.stringify({ missing: { react: ['src/App.tsx'] } });
    const out = parseDepcheckJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('missing-in-package-json');
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.filePath).toBe('/tmp/pkg/src/App.tsx');
    expect(out[0]?.dependency).toBe('react');
  });
  it('parses invalidFiles as warn-level unresolved-import', () => {
    const json = JSON.stringify({ invalidFiles: { 'src/bad.ts': 'SyntaxError' } });
    const out = parseDepcheckJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warn');
    expect(out[0]?.message).toContain('parser failed');
  });
  it('tolerates leading text before the JSON object', () => {
    const json = 'noisy stderr line\n' + JSON.stringify({ dependencies: ['x'] });
    expect(parseDepcheckJson(json, '/tmp/pkg')).toHaveLength(1);
  });
  it('throws on malformed JSON body', () => {
    expect(() => parseDepcheckJson('{not-json}', '/tmp/pkg')).toThrow();
  });
  it('runDepcheck with stdoutOverride bypasses spawn', async () => {
    const json = JSON.stringify({ dependencies: ['lodash'] });
    const res = await runDepcheck('/tmp/pkg', { stdoutOverride: json });
    expect(res.tooling).toBe('present');
    expect(res.findings).toHaveLength(1);
  });
  it('runDepcheck with absent binary returns tooling=absent', async () => {
    const res = await runDepcheck('/tmp/pkg', { binaryOverride: '/no/such/depcheck-xyz' });
    expect(res.tooling).toBe('absent');
  });
});
