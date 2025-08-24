import 'jest-extended';

// Global test configuration
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'error';
  process.env.JIRA_MOCK_MODE = 'true';
  
  // Increase timeout for complex operations
  jest.setTimeout(30000);
});

afterAll(() => {
  // Clean up test environment
  delete process.env.JIRA_MOCK_MODE;
});

beforeEach(() => {
  // Clear all mocks before each test
  jest.clearAllMocks();
  jest.restoreAllMocks();
  jest.resetAllMocks();
});

// Global test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidJiraIssue(): R;
      toHaveValidHierarchy(): R;
      toCompleteWithinTime(ms: number): R;
      toHaveValidAgentResponse(): R;
    }
  }
}

// Custom matchers
expect.extend({
  toBeValidJiraIssue(received: any) {
    const pass = received && 
                 typeof received.key === 'string' &&
                 typeof received.summary === 'string' &&
                 received.issueType &&
                 received.project;
    
    return {
      message: () => `expected ${received} to be a valid JIRA issue`,
      pass,
    };
  },

  toHaveValidHierarchy(received: any) {
    const pass = received &&
                 Array.isArray(received.children) &&
                 typeof received.level === 'number' &&
                 received.level >= 0;
    
    return {
      message: () => `expected ${received} to have valid hierarchy structure`,
      pass,
    };
  },

  toCompleteWithinTime(received: Promise<any>, timeMs: number) {
    return Promise.race([
      received,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Operation took longer than ${timeMs}ms`)), timeMs)
      )
    ]).then(
      () => ({ pass: true, message: () => `Operation completed within ${timeMs}ms` }),
      () => ({ pass: false, message: () => `Operation exceeded ${timeMs}ms` })
    );
  },

  toHaveValidAgentResponse(received: any) {
    const pass = received &&
                 typeof received.status === 'string' &&
                 received.data &&
                 typeof received.timestamp === 'number';
    
    return {
      message: () => `expected ${received} to be a valid agent response`,
      pass,
    };
  }
});

// Mock console methods to reduce noise in tests unless explicitly needed
const originalError = console.error;
const originalWarn = console.warn;
const originalLog = console.log;

console.error = jest.fn();
console.warn = jest.fn();
console.log = jest.fn();

// Restore console for specific tests that need it
export const restoreConsole = () => {
  console.error = originalError;
  console.warn = originalWarn;
  console.log = originalLog;
};

// Helper for async test cleanup
export const withTimeout = (fn: () => Promise<void>, timeoutMs = 5000) => {
  return Promise.race([
    fn(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Test timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};