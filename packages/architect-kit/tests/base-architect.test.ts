import { describe, it, expect } from 'vitest';
import { BaseArchitect } from '../src/base-architect.js';
import type { ArchitectInput, ArchitectOutput } from '../src/types.js';
import { makeContract, stubInput } from './fixtures.js';

class TestArchitect extends BaseArchitect {
  readonly name = 'test';
  readonly sectionContract = makeContract('test', ['test.a', 'test.b']);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async run(_input: ArchitectInput): Promise<ArchitectOutput> {
    return this.okOutput({ 'test.a': 1, 'test.b': 2 }, { confidence: 0.9 });
  }
}

describe('BaseArchitect', () => {
  it('provides a default system prompt mentioning the architect name', () => {
    const a = new TestArchitect();
    const p = a.systemPrompt();
    expect(p).toContain('test');
    expect(p).toContain('test.a');
    expect(p).toContain('test.b');
  });

  it('defaults to empty tools', () => {
    const a = new TestArchitect();
    expect(a.tools).toEqual([]);
  });

  it('okOutput downgrades to partial when required paths are missing', async () => {
    class HalfArchitect extends BaseArchitect {
      readonly name = 'half';
      readonly sectionContract = makeContract('half', ['half.a', 'half.b']);
      async run(_input: ArchitectInput): Promise<ArchitectOutput> {
        return this.okOutput({ 'half.a': 1 }, { confidence: 0.5 });
      }
    }
    const out = await new HalfArchitect().run(stubInput());
    expect(out.status).toBe('partial');
    expect(out.failureReason).toMatch(/missing required paths.*half\.b/);
  });

  it('okOutput stays "ok" when all required paths are present', async () => {
    const out = await new TestArchitect().run(stubInput());
    expect(out.status).toBe('ok');
    expect(out.architectName).toBe('test');
    expect(out.architectureFields).toEqual({ 'test.a': 1, 'test.b': 2 });
  });

  it('failedOutput returns a failed status with reason', () => {
    class FailingArchitect extends BaseArchitect {
      readonly name = 'fail';
      readonly sectionContract = makeContract('fail', ['fail.a']);
      async run(_input: ArchitectInput): Promise<ArchitectOutput> {
        return this.failedOutput('LLM timed out');
      }
    }
    return new FailingArchitect().run(stubInput()).then((out) => {
      expect(out.status).toBe('failed');
      expect(out.failureReason).toBe('LLM timed out');
      expect(out.architectureFields).toEqual({});
    });
  });

  it('partialOutput returns a partial status', async () => {
    class PartialArchitect extends BaseArchitect {
      readonly name = 'p';
      readonly sectionContract = makeContract('p', ['p.a']);
      async run(_input: ArchitectInput): Promise<ArchitectOutput> {
        return this.partialOutput({ 'p.a': 'x' }, { confidence: 0.4, notes: 'low conf' });
      }
    }
    const out = await new PartialArchitect().run(stubInput());
    expect(out.status).toBe('partial');
    expect(out.notes).toBe('low conf');
  });

  it('missingPaths surfaces undeclared shortfalls', () => {
    const c = makeContract('m', ['m.a', 'm.b', 'm.c']);
    expect(BaseArchitect.missingPaths(c, { 'm.a': 1 })).toEqual(['m.b', 'm.c']);
  });

  it('extraPaths surfaces fields the architect declared but contract did not own', () => {
    const c = makeContract('m', ['m.a']);
    expect(BaseArchitect.extraPaths(c, { 'm.a': 1, 'rogue': 2 })).toEqual(['rogue']);
  });

  it('zeroSpend uses the named model', () => {
    const a = new TestArchitect();
    const spend = (a as unknown as { zeroSpend: (m?: string) => { model: string } }).zeroSpend('haiku');
    expect(spend.model).toBe('haiku');
  });
});
