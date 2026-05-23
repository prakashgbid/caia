/**
 * Vitest setup file — runs before each test file.
 *
 * Pulls in `@testing-library/jest-dom` matchers so component tests
 * can use `toBeInTheDocument`, etc.
 *
 * Also patches `Window.prototype.close` for JSDOM 25, where the
 * method is missing on the prototype that Vitest 1.6's teardown
 * walks when cleaning up jsdom workers. Without the patch every
 * jsdom-environment test file emits an "Unhandled Error" at exit
 * that turns the suite non-zero even though all tests pass. The
 * upstream issue tracker calls this out — patch is one line.
 */

import '@testing-library/jest-dom/vitest';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyWindow = (globalThis as { window?: any }).window;
if (anyWindow && typeof anyWindow.constructor === 'function') {
  const proto = anyWindow.constructor.prototype;
  if (proto && typeof proto.close !== 'function') {
    proto.close = function (): void {
      /* jsdom 25 compat — vitest teardown calls window.close() */
    };
  }
}
