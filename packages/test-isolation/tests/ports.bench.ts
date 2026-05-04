/**
 * Benchmark for @chiefaia/test-isolation/ports.
 *
 * Goal: per-test allocation must be cheap. Single-port allocation is
 * one bind+close on loopback (~1 ms); range-of-3 should scale linearly.
 */

import { bench, describe } from 'vitest';
import {
  allocateTestPort,
  allocateTestPortRange,
  releaseTestPort,
} from '../src/ports.js';

describe('allocator performance', () => {
  bench('allocate + release single port', async () => {
    const p = await allocateTestPort();
    releaseTestPort(p);
  });

  bench('allocate + release range of 3', async () => {
    const block = await allocateTestPortRange({ count: 3 });
    releaseTestPort(block);
  });
});
