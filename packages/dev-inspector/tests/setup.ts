import '@testing-library/jest-dom';
import { vi, beforeAll } from 'vitest';

// Mock navigator.clipboard for jsdom (jsdom doesn't implement it)
beforeAll(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    writable: true,
    configurable: true,
  });
});
