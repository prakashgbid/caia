import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import type { SectionContract, SectionSpec } from '@chiefaia/ticket-template';
import {
  ContractRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
  register,
} from '../src';

const baseSpec: SectionSpec = {
  name: 'scope',
  description: 'desc',
  purpose: 'purpose',
  dataShape: z.object({}).passthrough(),
  required: true,
  rubric: { severityOnFail: 'hard', fixHint: 'fix it' },
  examples: [{ good: {}, bad: {}, badRationale: 'r' }],
};

function mkContract(
  contractId: string,
  ownerAgent: SectionContract['ownerAgent'] = 'po',
  scopes: SectionContract['appliesTo'] = ['story'],
  sections: readonly SectionSpec[] = [baseSpec],
): SectionContract {
  return { ownerAgent, contractId, version: '1.0.0', appliesTo: scopes, sections };
}

describe('ContractRegistry', () => {
  let reg: ContractRegistry;

  beforeEach(() => {
    reg = new ContractRegistry();
  });

  it('starts empty', () => {
    expect(reg.size()).toBe(0);
    expect(reg.list()).toEqual([]);
  });

  it('register adds a contract', () => {
    reg.register(mkContract('c1'));
    expect(reg.size()).toBe(1);
    expect(reg.get('c1')).toBeDefined();
  });

  it('register throws on duplicate contractId', () => {
    reg.register(mkContract('c1'));
    expect(() => reg.register(mkContract('c1'))).toThrow(/already registered/);
  });

  it('replace overwrites without throwing', () => {
    reg.register(mkContract('c1', 'po'));
    reg.replace(mkContract('c1', 'ba'));
    expect(reg.get('c1')?.ownerAgent).toBe('ba');
  });

  it('replace registers when absent', () => {
    reg.replace(mkContract('c1'));
    expect(reg.get('c1')).toBeDefined();
  });

  it('unregister removes and returns true; missing returns false', () => {
    reg.register(mkContract('c1'));
    expect(reg.unregister('c1')).toBe(true);
    expect(reg.unregister('c1')).toBe(false);
    expect(reg.size()).toBe(0);
  });

  it('list returns contracts in registration order', () => {
    reg.register(mkContract('a'));
    reg.register(mkContract('b'));
    reg.register(mkContract('c'));
    expect(reg.list().map((c) => c.contractId)).toEqual(['a', 'b', 'c']);
  });

  it('listByAgent filters by ownerAgent', () => {
    reg.register(mkContract('po1', 'po'));
    reg.register(mkContract('ba1', 'ba'));
    reg.register(mkContract('ea1', 'ea'));
    expect(reg.listByAgent('ba').map((c) => c.contractId)).toEqual(['ba1']);
    expect(reg.listByAgent('po').map((c) => c.contractId)).toEqual(['po1']);
  });

  it('clear empties the registry and resets registrationIndex', () => {
    reg.register(mkContract('c1'));
    reg.clear();
    expect(reg.size()).toBe(0);
    reg.register(mkContract('c1'));
    expect(reg.size()).toBe(1);
  });
});

describe('default singleton', () => {
  beforeEach(() => {
    resetDefaultRegistry();
  });

  it('getDefaultRegistry returns the same instance across calls', () => {
    const a = getDefaultRegistry();
    const b = getDefaultRegistry();
    expect(a).toBe(b);
  });

  it('resetDefaultRegistry forces a fresh instance', () => {
    const a = getDefaultRegistry();
    resetDefaultRegistry();
    const b = getDefaultRegistry();
    expect(a).not.toBe(b);
  });

  it('register() top-level shorthand uses the default singleton', () => {
    register(mkContract('c1'));
    expect(getDefaultRegistry().get('c1')).toBeDefined();
  });
});
