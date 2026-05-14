import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fireHandoffRefresh } from '../src/handoff-refresh.js';

function waitForFile(path: string, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (existsSync(path)) return resolve();
      if (Date.now() - start > timeoutMs) {
        return reject(new Error(`timeout waiting for ${path}`));
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe('fireHandoffRefresh', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'handoff-refresh-'));
  });

  it('no-ops silently when the refresh script does not exist', () => {
    const missing = join(tmp, 'does-not-exist.sh');
    expect(() =>
      fireHandoffRefresh({ triggeredBy: 'test', scriptPath: missing }),
    ).not.toThrow();
  });

  it('no-ops when enabled=false', () => {
    const script = join(tmp, 'should-not-run.sh');
    writeFileSync(script, '#!/bin/bash\ntouch ' + join(tmp, 'ran') + '\n', {
      mode: 0o755,
    });
    fireHandoffRefresh({
      triggeredBy: 'test',
      scriptPath: script,
      enabled: false,
    });
    // give the (non-spawned) process a tick
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(existsSync(join(tmp, 'ran'))).toBe(false);
        resolve();
      }, 100);
    });
  });

  it('spawns the script detached with --triggered-by forwarded', async () => {
    const script = join(tmp, 'recorder.sh');
    const outFile = join(tmp, 'reason.txt');
    // Script writes its second arg ($2) — the reason — to a file we can assert on.
    writeFileSync(
      script,
      `#!/bin/bash\n` +
        `if [ "$1" = "--triggered-by" ]; then echo "$2" > "${outFile}"; fi\n`,
      { mode: 0o755 },
    );
    fireHandoffRefresh({
      triggeredBy: 'pr-merged-foo/bar#123',
      scriptPath: script,
    });
    await waitForFile(outFile);
    expect(readFileSync(outFile, 'utf8').trim()).toBe(
      'pr-merged-foo/bar#123',
    );
  });

  it('truncates a too-long reason to 120 chars and strips newlines', async () => {
    const script = join(tmp, 'recorder.sh');
    const outFile = join(tmp, 'reason.txt');
    writeFileSync(
      script,
      `#!/bin/bash\n` +
        `if [ "$1" = "--triggered-by" ]; then echo "$2" > "${outFile}"; fi\n`,
      { mode: 0o755 },
    );
    const long = 'a'.repeat(200);
    fireHandoffRefresh({
      triggeredBy: long + '\nINJECT',
      scriptPath: script,
    });
    await waitForFile(outFile);
    const got = readFileSync(outFile, 'utf8').trim();
    // Newlines replaced with spaces, then sliced to 120.
    expect(got.length).toBe(120);
    expect(got.includes('\n')).toBe(false);
  });

  it('honors CAIA_DISABLE_HANDOFF_REFRESH=1', () => {
    const script = join(tmp, 'should-not-run.sh');
    const marker = join(tmp, 'ran');
    writeFileSync(script, `#!/bin/bash\ntouch "${marker}"\n`, { mode: 0o755 });
    const prev = process.env.CAIA_DISABLE_HANDOFF_REFRESH;
    process.env.CAIA_DISABLE_HANDOFF_REFRESH = '1';
    try {
      fireHandoffRefresh({ triggeredBy: 'test', scriptPath: script });
    } finally {
      if (prev === undefined) delete process.env.CAIA_DISABLE_HANDOFF_REFRESH;
      else process.env.CAIA_DISABLE_HANDOFF_REFRESH = prev;
    }
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        expect(existsSync(marker)).toBe(false);
        resolve();
      }, 100);
    });
  });
});
