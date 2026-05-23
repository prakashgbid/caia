import { describe, expect, it } from 'vitest';
import { InMemoryBYOCAdapter } from '../../src/byoc-adapter.js';

describe('InMemoryBYOCAdapter', () => {
  it('putBlob then getBlob returns the bytes', async () => {
    const a = new InMemoryBYOCAdapter();
    await a.putBlob('t1', 'k', Buffer.from('hello'));
    const got = await a.getBlob('t1', 'k');
    expect(got.toString()).toBe('hello');
  });

  it('headBlob reports existence + size', async () => {
    const a = new InMemoryBYOCAdapter();
    await a.putBlob('t1', 'k', Buffer.from('1234'));
    const head = await a.headBlob('t1', 'k');
    expect(head.exists).toBe(true);
    expect(head.size).toBe(4);
  });

  it('headBlob on missing key returns exists:false', async () => {
    const a = new InMemoryBYOCAdapter();
    const head = await a.headBlob('t1', 'missing');
    expect(head.exists).toBe(false);
  });

  it('deleteBlob is idempotent', async () => {
    const a = new InMemoryBYOCAdapter();
    await a.deleteBlob('t1', 'missing');
    await a.putBlob('t1', 'k', Buffer.from('x'));
    await a.deleteBlob('t1', 'k');
    expect((await a.headBlob('t1', 'k')).exists).toBe(false);
  });

  it('deletePrefix wipes only the matching tenant keys', async () => {
    const a = new InMemoryBYOCAdapter();
    await a.putBlob('t1', 'a/1', Buffer.from('1'));
    await a.putBlob('t1', 'a/2', Buffer.from('2'));
    await a.putBlob('t1', 'b/1', Buffer.from('3'));
    await a.putBlob('t2', 'a/1', Buffer.from('4')); // different tenant
    const out = await a.deletePrefix('t1', 'a/');
    expect(out.deletedCount).toBe(2);
    expect((await a.headBlob('t1', 'b/1')).exists).toBe(true);
    expect((await a.headBlob('t2', 'a/1')).exists).toBe(true);
  });

  it('does not leak across tenants', async () => {
    const a = new InMemoryBYOCAdapter();
    await a.putBlob('t1', 'k', Buffer.from('one'));
    await a.putBlob('t2', 'k', Buffer.from('two'));
    expect((await a.getBlob('t1', 'k')).toString()).toBe('one');
    expect((await a.getBlob('t2', 'k')).toString()).toBe('two');
  });

  it('counts puts so dedup tests can prove "uploaded once"', async () => {
    const a = new InMemoryBYOCAdapter();
    expect(a.putCount).toBe(0);
    await a.putBlob('t1', 'a', Buffer.from('x'));
    await a.putBlob('t1', 'b', Buffer.from('y'));
    expect(a.putCount).toBe(2);
  });
});
