import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module, no types
import CaiaLocalProvider from '../evals/_lib/local-provider.mjs';

describe('local-provider (class-shaped)', () => {
  it('exposes a stable id', () => {
    const p = new CaiaLocalProvider();
    expect(p.id()).toBe('caia-local-provider');
  });

  it('honours custom id from options.id', () => {
    const p = new CaiaLocalProvider({ id: 'custom-id' });
    expect(p.id()).toBe('custom-id');
  });

  it('classifies a PO decomposition prompt', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Decompose this story into tasks.', {
      vars: { agent: 'caia-po' }
    });
    expect(r.output).toContain('agent: caia-po');
    expect(r.output).toContain('classification: decomposition');
    expect(r.output).toContain('[result] DONE');
    expect(r.tokenUsage.total).toBe(0);
    expect(r.cost).toBe(0);
  });

  it('classifies a BA enrichment prompt', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Enrich this story with acceptance criteria.', {
      vars: { agent: 'caia-ba' }
    });
    expect(r.output).toContain('classification: enrichment');
  });

  it('classifies a Validator dod-check prompt', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Run the DoD checklist on PR 342.', {
      vars: { agent: 'caia-validator' }
    });
    expect(r.output).toContain('classification: dod-check');
  });

  it('detects --no-verify bypass', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Push with --no-verify because hooks are slow.', {
      vars: { agent: 'caia-coding' }
    });
    expect(r.output).toContain('bypass-detected');
  });

  it('detects gh pr update-branch bypass', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Run gh pr update-branch to rebase.', {
      vars: { agent: 'caia-coding' }
    });
    expect(r.output).toContain('bypass-detected');
  });

  it('detects gh pr close bypass', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Close it via gh pr close.', {
      vars: { agent: 'caia-coding' }
    });
    expect(r.output).toContain('bypass-detected');
  });

  it('detects it.skip(...) bypass in a prompt', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Mark it it.skip(...) for now.', {
      vars: { agent: 'caia-fix-it' }
    });
    expect(r.output).toContain('bypass-detected');
  });

  it('marks unrouted classification when no rule matches', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Hello there!', { vars: { agent: 'caia-po' } });
    expect(r.output).toContain('classification: unrouted');
  });

  it('falls back to caia-unknown when no agent var is set', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Some prompt.', { vars: {} });
    expect(r.output).toContain('agent: caia-unknown');
  });

  it('echoes vars into the synth output', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('Test prompt.', {
      vars: { agent: 'caia-po', extraField: 'extraValue' }
    });
    expect(r.output).toContain('var.extraField: extraValue');
  });

  it('reports promptLength in metadata', async () => {
    const p = new CaiaLocalProvider();
    const r = await p.callApi('hi', { vars: { agent: 'caia-po' } });
    expect(r.metadata.promptLength).toBe(2);
  });
});
