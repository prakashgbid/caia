import { describe, expect, it } from 'vitest';
import { parseDepCruiserJson, runDependencyCruiser } from '../src/scanners/dependency-cruiser.js';

describe('parseDepCruiserJson', () => {
  it('returns [] for empty stdout', () => {
    expect(parseDepCruiserJson('', '/tmp/pkg')).toEqual([]);
  });
  it('parses orphan modules as warn-level orphan-module', () => {
    const json = JSON.stringify({ modules: [{ source: 'src/orphan.ts', orphan: true }] });
    const out = parseDepCruiserJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('orphan-module');
    expect(out[0]?.severity).toBe('warn');
    expect(out[0]?.filePath).toBe('/tmp/pkg/src/orphan.ts');
  });
  it('parses couldNotResolve as error-level unresolved-import', () => {
    const json = JSON.stringify({
      modules: [{ source: 'src/a.ts', dependencies: [{ module: '@missing/x', couldNotResolve: true }] }],
    });
    const out = parseDepCruiserJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('unresolved-import');
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.dependency).toBe('@missing/x');
  });
  it('parses no-circular violation from summary as circular-dependency', () => {
    const json = JSON.stringify({
      summary: { violations: [{ from: 'src/a.ts', to: 'src/b.ts', cycle: ['src/a.ts','src/b.ts','src/a.ts'], rule: { name: 'no-circular', severity: 'error' } }] },
    });
    const out = parseDepCruiserJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('circular-dependency');
    expect(out[0]?.severity).toBe('error');
    expect(out[0]?.message).toContain('circular');
  });
  it('parses dev-dep-in-prod rule', () => {
    const json = JSON.stringify({
      modules: [{ source: 'src/a.ts', dependencies: [{ module: 'vitest', rules: [{ name: 'no-dev-dep-in-prod', severity: 'error' }] }] }],
    });
    const out = parseDepCruiserJson(json, '/tmp/pkg');
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('dev-dep-in-prod');
    expect(out[0]?.severity).toBe('error');
  });
  it('runDependencyCruiser with stdoutOverride parses without spawning', async () => {
    const json = JSON.stringify({ modules: [{ source: 'src/x.ts', orphan: true }] });
    const res = await runDependencyCruiser('/tmp/pkg', { stdoutOverride: json });
    expect(res.tooling).toBe('present');
    expect(res.findings).toHaveLength(1);
  });
  it('runDependencyCruiser absent binary returns tooling=absent', async () => {
    const res = await runDependencyCruiser('/tmp/pkg', { binaryOverride: '/no/such/depcruise-xyz' });
    expect(res.tooling).toBe('absent');
  });
});
