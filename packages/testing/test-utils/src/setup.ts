/**
 * @fileoverview Global test setup for CAIA test utilities
 * Configures Jest environment and common test settings
 */

import 'jest-environment-node';
import { configure } from '@testing-library/jest-dom';

// Configure testing library
configure({ 
  testIdAttribute: 'data-testid',
  asyncWrapper: async (cb) => {
    let result;
    await cb(() => {
      result = cb;
    });
    return result;
  }
});

// Global test timeout
jest.setTimeout(30000);

// Mock console methods to reduce noise in tests
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Restore console for specific tests that need it
export const restoreConsole = () => {
  global.console = originalConsole;
};

// Global test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(a: number, b: number): R;
      toBeValidAgent(): R;
      toHaveValidStructure(): R;
    }
  }
}

// Custom Jest matchers
expect.extend({
  toBeWithinRange(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling;
    if (pass) {
      return {
        message: () => `expected ${received} not to be within range ${floor} - ${ceiling}`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be within range ${floor} - ${ceiling}`,
        pass: false,
      };
    }
  },

  toBeValidAgent(received: any) {
    const pass = received && 
                 typeof received.id === 'string' &&
                 typeof received.name === 'string' &&
                 typeof received.execute === 'function';
    
    if (pass) {
      return {
        message: () => `expected object not to be a valid agent`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected object to be a valid agent with id, name, and execute method`,
        pass: false,
      };
    }
  },

  toHaveValidStructure(received: any) {
    const pass = received && 
                 typeof received === 'object' &&
                 !Array.isArray(received) &&
                 Object.keys(received).length > 0;
    
    if (pass) {
      return {
        message: () => `expected object not to have valid structure`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected object to have valid structure`,
        pass: false,
      };
    }
  },
});

// Global beforeEach setup
beforeEach(() => {
  // Clear all mocks
  jest.clearAllMocks();
  
  // Reset modules
  jest.resetModules();
  
  // Clear timers
  jest.clearAllTimers();
});

// Global afterEach cleanup
afterEach(() => {
  // Restore mocked functions
  jest.restoreAllMocks();
  
  // Clear any pending promises
  return new Promise(resolve => setImmediate(resolve));
});

// Environment cleanup
afterAll(() => {
  // Restore console
  global.console = originalConsole;
  
  // Clear any remaining timers
  jest.clearAllTimers();
});