/**
 * Tests for @chiefaia/test-isolation/ports.
 *
 * These tests bind real loopback sockets and assert allocator behavior
 * around contention. They are reasonably fast — each binds for <1 ms —
 * but they DO touch the network stack. If you see them flake on a
 * weird CI box, increase `maxAttempts` in the test calls.
 */

import * as net from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import {
  DEFAULT_PORT_CEILING,
  DEFAULT_PORT_FLOOR,
  allocateTestPort,
  allocateTestPortRange,
  deriveStartPort,
  listClaimedTestPorts,
  releaseTestPort,
} from '../src/ports.js';

const opened: net.Server[] = [];

afterEach(async () => {
  for (const s of opened.splice(0)) {
    await new Promise<void>((r) => {
      s.close(() => r());
    });
  }
});

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.once('error', reject);
    s.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      resolve(s);
    });
  });
}

describe('deriveStartPort', () => {
  test('is deterministic for a given testId + range', () => {
    const a = deriveStartPort('alpha', 1, 30000, 34999);
    const b = deriveStartPort('alpha', 1, 30000, 34999);
    expect(a).toBe(b);
  });

  test('differs for different testIds (almost always)', () => {
    const a = deriveStartPort('alpha', 1, 30000, 34999);
    const b = deriveStartPort('bravo', 1, 30000, 34999);
    expect(a).not.toBe(b);
  });

  test('always returns a port whose block fits in the range', () => {
    for (const id of ['x', 'y', 'z', 'aaaaaa', 'b'.repeat(100)]) {
      for (const count of [1, 5, 100]) {
        const p = deriveStartPort(id, count, 30000, 34999);
        expect(p).toBeGreaterThanOrEqual(30000);
        expect(p + count - 1).toBeLessThanOrEqual(34999);
      }
    }
  });

  test('throws when the range is smaller than the block', () => {
    expect(() => deriveStartPort('x', 100, 30000, 30050)).toThrow(/cannot fit/);
  });
});

describe('allocateTestPort', () => {
  test('returns a port within the default range', async () => {
    const port = await allocateTestPort({ testId: 'allocate-default' });
    expect(port).toBeGreaterThanOrEqual(DEFAULT_PORT_FLOOR);
    expect(port).toBeLessThanOrEqual(DEFAULT_PORT_CEILING);
    releaseTestPort(port);
  });

  test('returns a port that is actually bindable right after', async () => {
    const port = await allocateTestPort({ testId: 'bindable-after' });
    const server = await listenOn(port);
    opened.push(server);
    expect(server.listening).toBe(true);
    releaseTestPort(port);
  });

  test('two consecutive allocations in the same process do not collide', async () => {
    const a = await allocateTestPort({ testId: 'collision-a' });
    const b = await allocateTestPort({ testId: 'collision-b' });
    expect(a).not.toBe(b);
    releaseTestPort([a, b]);
  });

  test('allocator dodges a port that is already in use', async () => {
    // Pick a port that the deterministic hash would land on, occupy it,
    // then allocate the SAME testId — the allocator should probe forward
    // and return a different port.
    const id = 'dodge-occupied';
    const candidate = deriveStartPort(id, 1, DEFAULT_PORT_FLOOR, DEFAULT_PORT_CEILING);
    const blocker = await listenOn(candidate);
    opened.push(blocker);

    const got = await allocateTestPort({ testId: id });
    expect(got).not.toBe(candidate);
    expect(got).toBeGreaterThan(candidate);

    const server = await listenOn(got);
    opened.push(server);
    expect(server.listening).toBe(true);
    releaseTestPort(got);
  });

  test('falls back to random offset when no testId is supplied', async () => {
    const a = await allocateTestPort();
    const b = await allocateTestPort();
    expect(a).toBeGreaterThanOrEqual(DEFAULT_PORT_FLOOR);
    expect(b).toBeGreaterThanOrEqual(DEFAULT_PORT_FLOOR);
    expect(a).not.toBe(b);
    releaseTestPort([a, b]);
  });
});

describe('allocateTestPortRange', () => {
  test('returns N consecutive free ports', async () => {
    const block = await allocateTestPortRange({ testId: 'range-3', count: 3 });
    expect(block).toHaveLength(3);
    expect(block[1]).toBe(block[0]! + 1);
    expect(block[2]).toBe(block[0]! + 2);
    releaseTestPort(block);
  });

  test('the returned array is frozen', async () => {
    const block = await allocateTestPortRange({ testId: 'range-frozen', count: 2 });
    expect(Object.isFrozen(block)).toBe(true);
    releaseTestPort(block);
  });

  test('rejects non-positive counts', async () => {
    await expect(allocateTestPortRange({ testId: 'x', count: 0 })).rejects.toThrow();
    await expect(allocateTestPortRange({ testId: 'x', count: -1 })).rejects.toThrow();
    // @ts-expect-error: testing runtime guard against non-integer
    await expect(allocateTestPortRange({ testId: 'x', count: 1.5 })).rejects.toThrow();
  });

  test('range probes around a blocked starting position', async () => {
    const id = 'range-blocked';
    const start = deriveStartPort(id, 3, DEFAULT_PORT_FLOOR, DEFAULT_PORT_CEILING);
    // Occupy start+1 → forces the allocator to probe past it.
    const blocker = await listenOn(start + 1);
    opened.push(blocker);

    const block = await allocateTestPortRange({ testId: id, count: 3 });
    // The block must not overlap the blocker.
    expect(block).not.toContain(start + 1);
    releaseTestPort(block);
  });
});

describe('listClaimedTestPorts + releaseTestPort', () => {
  test('claimed ports show up in the list, released ports do not', async () => {
    const before = listClaimedTestPorts();
    const port = await allocateTestPort({ testId: 'claim-list' });
    const after = listClaimedTestPorts();
    expect(after).toContain(port);
    expect(after.length).toBe(before.length + 1);

    releaseTestPort(port);
    expect(listClaimedTestPorts()).not.toContain(port);
  });

  test('returns a frozen, sorted snapshot', async () => {
    const a = await allocateTestPort({ testId: 'sort-a' });
    const b = await allocateTestPort({ testId: 'sort-b' });
    const list = listClaimedTestPorts();
    expect(Object.isFrozen(list)).toBe(true);
    // Sorted ascending
    for (let i = 1; i < list.length; i++) {
      expect(list[i]).toBeGreaterThan(list[i - 1]!);
    }
    releaseTestPort([a, b]);
  });

  test('releasing an array of ports is supported', async () => {
    const block = await allocateTestPortRange({ testId: 'release-array', count: 4 });
    releaseTestPort(block);
    for (const p of block) expect(listClaimedTestPorts()).not.toContain(p);
  });
});
