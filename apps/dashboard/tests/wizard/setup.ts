/**
 * Vitest setup — registers jest-dom matchers (toBeInTheDocument etc.)
 * and stubs a small handful of jsdom gaps (matchMedia / scrollTo) that
 * React 18 + Next.js client components touch incidentally.
 */
import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  // jsdom doesn't implement matchMedia; some shadcn primitives sniff it.
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  // jsdom's scrollTo is a no-op stub; declare it so our chat
  // auto-scroll effect doesn't error on missing method.
  if (!Element.prototype.scrollTo) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    Element.prototype.scrollTo = function scrollTo() {};
  }
}
