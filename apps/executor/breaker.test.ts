/**
 * Regression suite for the executor circuit breaker (EXEC-001).
 *
 * Pre-fix bug: breaker called `DELETE /executor/tasks/:id/unpause` with a
 * `{pause:true}` body. The orchestrator never exposed that route, so the
 * call silently 404'd and tasks accumulated 3000+ failed attempts. These
 * tests pin the contract: the breaker MUST POST /executor/tasks/:id/pause,
 * MUST trip immediately on auth failures, and MUST surface a structured
 * event when the pause itself fails so monitoring catches future
 * regressions.
 *
 * Note: the executor app currently has its `test` script stubbed out at
 * the package.json level (no test runner installed yet). These tests are
 * still written so they execute correctly under jest/vitest once a runner
 * is wired up — they pin the contract today and gate regressions tomorrow.
 */
import { checkAndBreak, isAuthFailure } from './breaker';

type FetchFn = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface RecordedCall {
  url: string;
  method: string;
  body: string | null;
}

function installFakeFetch(
  responder: (req: RecordedCall) => Partial<Response>,
): { calls: RecordedCall[]; restore: () => void } {
  const calls: RecordedCall[] = [];
  const original = (globalThis as unknown as { fetch?: FetchFn }).fetch;
  const fake: FetchFn = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = (init.method ?? 'GET').toUpperCase();
    const body =
      typeof init.body === 'string'
        ? init.body
        : init.body == null
        ? null
        : String(init.body);
    const recorded: RecordedCall = { url, method, body };
    calls.push(recorded);
    const partial = responder(recorded);
    return new Response(partial.body ?? '{"ok":true}', {
      status: partial.status ?? 200,
      headers: partial.headers,
    });
  };
  (globalThis as unknown as { fetch: FetchFn }).fetch = fake;
  return {
    calls,
    restore: () => {
      if (original) (globalThis as unknown as { fetch: FetchFn }).fetch = original;
    },
  };
}

describe('isAuthFailure', () => {
  it('matches Anthropic 401 authentication_error string', () => {
    expect(
      isAuthFailure(
        'exit code 1: Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}',
      ),
    ).toBe(true);
  });

  it('matches plain "Invalid authentication credentials"', () => {
    expect(isAuthFailure('Invalid authentication credentials')).toBe(true);
  });

  it('matches HTTP 401 / Unauthorized', () => {
    expect(isAuthFailure('HTTP 401 Unauthorized')).toBe(true);
  });

  it('matches CLAUDE_CODE_OAUTH_TOKEN parse failures', () => {
    expect(isAuthFailure('Bad CLAUDE_CODE_OAUTH_TOKEN at startup')).toBe(true);
  });

  it('does NOT match generic exit-1 failures', () => {
    expect(isAuthFailure('exit code 1: command not found')).toBe(false);
    expect(isAuthFailure('test failed: assertion error in foo.test.ts')).toBe(false);
    expect(isAuthFailure('')).toBe(false);
  });
});

describe('checkAndBreak — endpoint contract (EXEC-001 regression)', () => {
  it('does NOT trip below threshold for non-auth failures', async () => {
    const { calls, restore } = installFakeFetch(() => ({ status: 200 }));
    try {
      const tripped = await checkAndBreak('t1', 'Task A', 1, 3, 'flaky test failed');
      expect(tripped).toBe(false);
      expect(calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('trips at threshold and POSTs the correct pause endpoint', async () => {
    const { calls, restore } = installFakeFetch(() => ({ status: 200 }));
    try {
      const tripped = await checkAndBreak('t2', 'Task B', 3, 3, 'still flaky');
      expect(tripped).toBe(true);

      const pauseCall = calls.find(c => c.url.endsWith('/executor/tasks/t2/pause'));
      expect(pauseCall).toBeDefined();
      // Pinned contract: must be POST, not DELETE — pre-fix bug used DELETE.
      expect(pauseCall!.method).toBe('POST');
      expect(pauseCall!.body).toContain('Circuit breaker: 3 failed attempts');

      // Pinned contract: must NEVER call the legacy /unpause endpoint with
      // a `pause:true` body (that was the silent-404 bug).
      const wrongCall = calls.find(c => c.url.includes('/unpause'));
      expect(wrongCall).toBeUndefined();
    } finally {
      restore();
    }
  });

  it('files a high-severity blocker on threshold trip', async () => {
    const { calls, restore } = installFakeFetch(() => ({ status: 200 }));
    try {
      await checkAndBreak('t3', 'Task C', 5, 3, 'persistent failure');
      const blockerCall = calls.find(c => c.url.endsWith('/blockers'));
      expect(blockerCall).toBeDefined();
      expect(blockerCall!.body).toContain('"severity":"high"');
      expect(blockerCall!.body).toContain('"kind":"circuit-breaker"');
    } finally {
      restore();
    }
  });
});

describe('checkAndBreak — auth-error fast-trip (EXEC-001)', () => {
  const authReason =
    'exit code 1: Failed to authenticate. API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"Invalid authentication credentials"}}';

  it('trips on attempt 1 for auth failures (bypasses threshold)', async () => {
    const { calls, restore } = installFakeFetch(() => ({ status: 200 }));
    try {
      const tripped = await checkAndBreak('t4', 'Task D', 1, 999, authReason);
      expect(tripped).toBe(true);

      const pauseCall = calls.find(c => c.url.endsWith('/executor/tasks/t4/pause'));
      expect(pauseCall).toBeDefined();
      expect(pauseCall!.method).toBe('POST');
      expect(pauseCall!.body).toContain('auth-error fast-trip');
    } finally {
      restore();
    }
  });

  it('files a CRITICAL blocker on auth-trip (not high)', async () => {
    const { calls, restore } = installFakeFetch(() => ({ status: 200 }));
    try {
      await checkAndBreak('t5', 'Task E', 1, 999, authReason);
      const blockerCall = calls.find(c => c.url.endsWith('/blockers'));
      expect(blockerCall).toBeDefined();
      expect(blockerCall!.body).toContain('"severity":"critical"');
      expect(blockerCall!.body).toContain('"kind":"auth-error"');
      expect(blockerCall!.body).toContain('CLAUDE_CODE_OAUTH_TOKEN');
    } finally {
      restore();
    }
  });
});

describe('checkAndBreak — observability', () => {
  it('emits executor.breaker.pause_failed when pause endpoint returns non-2xx', async () => {
    // First fetch (pause) returns 404; subsequent fetches return 200.
    let fetchN = 0;
    const { calls, restore } = installFakeFetch(() => {
      fetchN += 1;
      if (fetchN === 1) return { status: 404, body: 'Not Found' };
      return { status: 200 };
    });
    try {
      const tripped = await checkAndBreak('t6', 'Task F', 3, 3, 'still flaky');
      expect(tripped).toBe(true);

      // Best-effort observability event must have been written.
      const eventCall = calls.find(c => c.url.endsWith('/events'));
      expect(eventCall).toBeDefined();
      expect(eventCall!.body).toContain('executor.breaker.pause_failed');
    } finally {
      restore();
    }
  });
});
