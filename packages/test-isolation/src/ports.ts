/**
 * @chiefaia/test-isolation/ports
 *
 * Per-test localhost port isolation (FIX-009).
 *
 * Why this is hard:
 *   - Asking the kernel for a free port (`server.listen(0)`) — what
 *     `get-port` does — works for ONE port at a time but two parallel
 *     tests can race the same port if they each call this just before
 *     binding. Classic TOCTOU window.
 *   - Many of our consumers need a *block* of consecutive ports (the
 *     orchestrator + dashboard + a stub upstream all on adjacent
 *     ports). Hash-based deterministic allocation gives each test a
 *     non-overlapping slice without any inter-process coordination.
 *
 * Strategy (the same shape `pytest-xdist` and Playwright's worker
 * fixtures use):
 *
 *   1. **Deterministic offset** — `start = floor + hash(testId) mod window`.
 *      Same test always gets the same starting port across runs, which
 *      makes failures reproducible and makes parallel collisions unlikely.
 *   2. **Probe forward** — from `start`, scan upward until we find N
 *      consecutive ports that all bind successfully. Re-probe is the
 *      safety net for hash collisions across parallel workers.
 *   3. **Bind-and-release** — the helper opens, immediately closes, and
 *      hands the port to the caller. There is a TOCTOU window of a few
 *      ms; the deterministic starting offset makes parallel tests
 *      *very* unlikely to land on the same probe sequence.
 *
 * Range:
 *   30000-34999 by default — well above the user-port floor (1024) and
 *   below the IANA dynamic range (49152) where the kernel hands out
 *   ephemeral ports for outgoing connections. 5000 candidates is plenty
 *   for our shard count + headroom.
 *
 * The API is async (matches `get-port` and the realities of `net`).
 *
 * Usage (Vitest):
 *
 *   import { allocateTestPort } from '@chiefaia/test-isolation/ports';
 *
 *   beforeEach(async ({ task }) => {
 *     const port = await allocateTestPort({ testId: task.id });
 *     // start your server bound to `port`
 *   });
 *
 *   // Multi-port:
 *   const [orchestratorPort, dashboardPort] =
 *     await allocateTestPortRange({ testId: task.id, count: 2 });
 */

import * as net from 'node:net';
import { createHash } from 'node:crypto';

/** Default port-range bounds. Tunable via {@link AllocateTestPortOptions}. */
export const DEFAULT_PORT_FLOOR = 30000;
export const DEFAULT_PORT_CEILING = 34999;

/** Options for {@link allocateTestPort} and {@link allocateTestPortRange}. */
export interface AllocateTestPortOptions {
  /**
   * Stable identifier for the test — Vitest's `task.id`, Playwright's
   * `testInfo.titlePath.join('>')`, or any string the runner can supply
   * deterministically. Drives the starting port via a SHA-1 hash.
   * If omitted, falls back to a random offset (still safe; just not
   * reproducible across runs).
   */
  testId?: string;

  /** Lower bound (inclusive). Default {@link DEFAULT_PORT_FLOOR}. */
  floor?: number;

  /** Upper bound (inclusive). Default {@link DEFAULT_PORT_CEILING}. */
  ceiling?: number;

  /**
   * Maximum probes before giving up. Default 1000. A higher value is
   * safer but spends more wall time on a hopelessly contended box.
   */
  maxAttempts?: number;
}

export interface AllocateTestPortRangeOptions extends AllocateTestPortOptions {
  /** How many consecutive ports to allocate. Required; must be >= 1. */
  count: number;
}

// ---------------------------------------------------------------------------
// In-process registry — same process must not hand out the same port
// twice even if two beforeEach hooks fire interleaved. The kernel
// handles cross-process collisions via EADDRINUSE; this just shortens
// the probe.
// ---------------------------------------------------------------------------

const claimedThisProcess = new Set<number>();

/**
 * Compute the starting port for a given test ID + range.
 *
 * Pure function, exported for testing. Returns a port in
 * `[floor, ceiling - count + 1]` so a contiguous block of `count` ports
 * starting at the result fits inside the range.
 */
export function deriveStartPort(
  testId: string,
  count: number,
  floor: number,
  ceiling: number,
): number {
  const window = ceiling - count + 1 - floor + 1;
  if (window <= 0) {
    throw new Error(
      `port range [${floor}, ${ceiling}] cannot fit a block of ${count} ports`,
    );
  }
  const digest = createHash('sha1').update(testId).digest();
  // First 4 bytes as a big-endian uint32, modulo window. SHA-1 truncation
  // is fine here — collisions are accepted (we re-probe on conflict).
  // Use Buffer.readUInt32BE to avoid the int32/uint32 sign trap that
  // bitwise OR in JS would expose.
  const u32 = digest.readUInt32BE(0);
  return floor + (u32 % window);
}

/**
 * Allocate a single isolated localhost port.
 *
 * Returns a port that was free at the moment of allocation. The caller
 * is responsible for binding it before another process can claim it.
 * Throws if no port can be found within `maxAttempts` probes.
 */
export async function allocateTestPort(
  opts: AllocateTestPortOptions = {},
): Promise<number> {
  const block = await allocateTestPortRange({ ...opts, count: 1 });
  return block[0]!;
}

/**
 * Allocate `count` consecutive isolated localhost ports.
 *
 * Useful for tests that need orchestrator + dashboard + stub all on
 * adjacent ports.
 */
export async function allocateTestPortRange(
  opts: AllocateTestPortRangeOptions,
): Promise<readonly number[]> {
  const count = opts.count;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, got ${String(count)}`);
  }
  const floor = opts.floor ?? DEFAULT_PORT_FLOOR;
  const ceiling = opts.ceiling ?? DEFAULT_PORT_CEILING;
  const maxAttempts = opts.maxAttempts ?? 1000;
  const testId = opts.testId ?? randomTestId();

  let attempt = 0;
  let probe = deriveStartPort(testId, count, floor, ceiling);

  while (attempt < maxAttempts) {
    const block = await tryClaimRange(probe, count, ceiling);
    if (block !== null) return Object.freeze(block);
    attempt += 1;
    // Linear scan; wraps around modulo the window.
    probe += 1;
    if (probe + count - 1 > ceiling) probe = floor;
  }

  throw new Error(
    `could not allocate ${String(count)} consecutive free port(s) in [${String(floor)}, ${String(ceiling)}] after ${String(maxAttempts)} attempts`,
  );
}

/**
 * Release ports back to the in-process registry. Call this when a test
 * tears down its server so subsequent tests in the same process can
 * reuse the slot. Cross-process release is automatic — the kernel
 * frees the port when the listener closes.
 */
export function releaseTestPort(port: number | readonly number[]): void {
  if (Array.isArray(port)) {
    for (const p of port) claimedThisProcess.delete(p);
  } else {
    claimedThisProcess.delete(port as number);
  }
}

/**
 * Snapshot of ports claimed in this process. Used by the FIX-013
 * dashboard panel and diagnostics.
 */
export function listClaimedTestPorts(): readonly number[] {
  return Object.freeze([...claimedThisProcess].sort((a, b) => a - b));
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function randomTestId(): string {
  return `random-${Math.random().toString(36).slice(2)}`;
}

async function tryClaimRange(
  start: number,
  count: number,
  ceiling: number,
): Promise<number[] | null> {
  if (start + count - 1 > ceiling) return null;
  const block: number[] = [];
  for (let i = 0; i < count; i++) {
    const port = start + i;
    if (claimedThisProcess.has(port)) return null;
    const free = await isPortBindable(port);
    if (!free) return null;
    block.push(port);
  }
  // All ports were free at probe time — claim them.
  for (const p of block) claimedThisProcess.add(p);
  return block;
}

/**
 * Probe whether a port is bindable on the loopback interface.
 *
 * Opens a server with `exclusive: true` (so the kernel surfaces
 * EADDRINUSE rather than load-balancing), takes the immediate listen
 * result, then closes. Returns false on any listen error.
 *
 * Resolves quickly — typically sub-millisecond.
 */
function isPortBindable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    let settled = false;
    const settle = (result: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch {
        // ignore
      }
      resolve(result);
    };

    server.once('error', () => settle(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => {
      settle(true);
    });

    // Defensive timeout in case neither listen nor error fires (kernel
    // pathologies). 250 ms is generous — localhost binds finish in
    // microseconds on every modern kernel we ship on.
    setTimeout(() => settle(false), 250).unref();
  });
}
