import { describe, expect, it } from 'vitest';
import { parseKnipJson, runKnip } from '../src/scanners/knip.js';

describe('parseKnipJson', () => {
  it('returns [] for empty stdout', () => {
    expect(parseKnipJson('', '/tmp/pkg')).toEqual([]);
  });

  it('returns [] for stdout with no JSON object', () => {
    expect(parseKnipJson('no json here', '/tmp/pkg')).toEqual([]);
  });

  it('parses unused files into unused-file findings (error severity)', () => {
    const json = JSON.stringify({ files: ['src/orphan.ts'] });
    const out = parseKnipJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.scanner).toBe('knip');
    expect(out[0]?.kind).toBe('unused-file');
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.filePath).toBe('/tmp/pkg/src/orphan.ts');
  });

  it('parses unused exports', () => {
    const json = JSON.stringify({
      issues: [{ file: 'src/a.ts', exports: [{ name: 'Foo', line: 1, col: 1 }] }],
    });
    const out = parseKnipJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('unused-export');
    expect(out[0]?.symbol).toBe('Foo');
    expect(out[0]?.severity).toBe('error');
  });

  it('parses type exports as warn-level unused-export', () => {
    const json = JSON.stringify({
      issues: [{ file: 'src/a.ts', types: [{ name: 'T', line: 1, col: 1 }] }],
    });
    const out = parseKnipJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('warn');
  });

  it('parses unused enum members + class members as warn-level', () => {
    const json = JSON.stringify({
      issues: [{
        file: 'src/a.ts',
        enumMembers: [{ name: 'E.A' }],
        classMembers: [{ name: 'C.m' }],
      }],
    });
    const out = parseKnipJson(json, '/tmp/pkg');
    expect(out.map((f) => f.kind).sort()).toEqual(['unused-class-member', 'unused-enum-member']);
    expect(out.every((f) => f.severity === 'warn')).toBe(true);
  });

  it('parses dependencies (error), devDependencies (info), and unlisted (error)', () => {
    const json = JSON.stringify({
      issues: [{
        file: 'package.json',
        dependencies: [{ name: 'lodash' }],
        devDependencies: [{ name: 'eslint-plugin-x' }],
        unlisted: [{ name: 'react' }],
      }],
    });
    const out = parseKnipJson(json, '/tmp/pkg');
    const byDep = Object.fromEntries(out.map((f) => [f.dependency, f]));
    expect(byDep['lodash']?.kind).toBe('unused-dependency');
    expect(byDep['lodash']?.severity).toBe('error');
    expect(byDep['eslint-plugin-x']?.severity).toBe('info');
    expect(byDep['react']?.kind).toBe('unlisted-dependency');
    expect(byDep['react']?.severity).toBe('error');
  });

  it('parses unresolved imports', () => {
    const json = JSON.stringify({
      issues: [{ file: 'src/a.ts', unresolved: [{ name: '@missing/pkg' }] }],
    });
    const out = parseKnipJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('unresolved-import');
    expect(out[0]?.dependency).toBe('@missing/pkg');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseKnipJson('{not-json}', '/tmp/pkg')).toThrow();
  });

  it('tolerates leading header text before the JSON object', () => {
    const json = 'log noise\n' + JSON.stringify({ files: ['src/x.ts'] });
    const out = parseKnipJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
  });

  it('runKnip with stdoutOverride bypasses spawn and produces findings', async () => {
    const json = JSON.stringify({ files: ['src/x.ts'] });
    const res = await runKnip('/tmp/pkg', { stdoutOverride: json });
    expect(res.tooling).toBe('present');
    expect(res.scanner).toBe('knip');
    expect(res.findings).toHaveLength(1);
    expect(res.durationMs).toBe(0);
  });

  it('runKnip with absent binary returns tooling=absent and no findings', async () => {
    const res = await runKnip('/tmp/pkg', { binaryOverride: '/definitely/not/here/knip-xyz' });
    expect(res.tooling).toBe('absent');
    expect(res.findings).toHaveLength(0);
  });
});
