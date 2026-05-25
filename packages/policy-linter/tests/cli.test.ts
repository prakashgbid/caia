import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildContextFromArgs, parseArgs, selectPolicies } from '../src/cli.js';
import { defaultPolicies } from '../src/index.js';

async function tempBrief(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'policy-lint-'));
  const p = join(dir, 'brief.md');
  await writeFile(p, content, 'utf8');
  return p;
}

describe('cli.parseArgs', () => {
  it('parses a minimal command-line', () => {
    const p = parseArgs(['brief.md']);
    expect(p.briefPath).toBe('brief.md');
    expect(p.format).toBe('line');
    expect(p.intent).toBe('build');
    expect(p.targetRepos).toEqual(['caia']);
  });

  it('parses repeated --target-repo flags', () => {
    const p = parseArgs(['brief.md', '--target-repo', 'a', '--target-repo', 'b']);
    expect(p.targetRepos).toEqual(['a', 'b']);
  });

  it('parses --metadata key=value into the metadata bag', () => {
    const p = parseArgs(['brief.md', '--metadata', 'eaGateGracePeriod=true']);
    expect(p.metadata.eaGateGracePeriod).toBe('true');
  });

  it('rejects unknown flags', () => {
    expect(() => parseArgs(['brief.md', '--bogus'])).toThrow(/Unknown flag/);
  });

  it('rejects --format with bad value', () => {
    expect(() => parseArgs(['brief.md', '--format', 'xml'])).toThrow(/--format/);
  });

  it('rejects missing required brief positional', () => {
    expect(() => parseArgs([])).toThrow(/Missing required/);
  });

  it('parses --open-pr-count as a number', () => {
    const p = parseArgs(['brief.md', '--open-pr-count', '3']);
    expect(p.openPrCount).toBe(3);
  });
});

describe('cli.selectPolicies', () => {
  it('returns all policies when filter is empty', () => {
    const out = selectPolicies([]);
    expect(out.length).toBe(defaultPolicies.length);
  });
  it('selects only the named policies', () => {
    const out = selectPolicies(['shadcn-not-mui', 'auto-merge-prs']);
    expect(out.map((p) => p.id).sort()).toEqual(['auto-merge-prs', 'shadcn-not-mui']);
  });
  it('throws on filter that matches nothing', () => {
    expect(() => selectPolicies(['no-such-policy'])).toThrow(/No policies matched/);
  });
});

describe('cli.buildContextFromArgs', () => {
  it('reads the brief markdown from disk', async () => {
    const p = await tempBrief('# Hello\n\nWorld.');
    const ctx = await buildContextFromArgs(parseArgs([p]));
    expect(ctx.briefMd).toMatch(/Hello/);
  });

  it('plumbs intent and target repos onto the context', async () => {
    const p = await tempBrief('body');
    const ctx = await buildContextFromArgs(
      parseArgs([p, '--intent', 'research', '--target-repo', 'caia'])
    );
    expect(ctx.intent).toBe('research');
    expect(ctx.targetRepos).toEqual(['caia']);
  });
});
