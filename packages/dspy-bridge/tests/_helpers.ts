import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

/**
 * Make a throwaway "fake uv" shim that just runs `python3` with the
 * args after `uv run --directory <dir> python ...`. Lets unit tests
 * avoid requiring `uv` on the test runner. Only used by tests that
 * stub the python module.
 */
export function makeFakeUv(): { uvBin: string; cleanup: () => void } {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dspy-bridge-fake-uv-'));
  const bin = path.join(tmp, 'uv');
  const script = `#!/usr/bin/env bash
# fake uv — drops the first two argv pairs ("run --directory <dir>") then
# execs python3 with the rest.
shift # 'run'
shift # '--directory'
shift # the dir itself
exec python3 "$@"
`;
  fs.writeFileSync(bin, script, { mode: 0o755 });
  return {
    uvBin: bin,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

/** Path to the python dir of this package (worktree-relative). */
export function pythonDir(): string {
  return path.resolve(__dirname, '..', 'python');
}
