import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/packages', '<rootDir>/apps'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dashboard/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@conductor/events-taxonomy$': '<rootDir>/packages/events-taxonomy/index.ts',
    '^@conductor/event-bus$': '<rootDir>/packages/event-bus/index.ts',
    '^@conductor/logger$': '<rootDir>/packages/logger/index.ts',
    '^@conductor/test-kit$': '<rootDir>/packages/test-kit/index.ts',
    '^@chiefaia/classifier$': '<rootDir>/packages/classifier/src/index.ts',
    // Remap ESM-style `.js` extension imports to `.ts` sources so ts-jest can
    // resolve them without requiring Node ESM module resolution.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        strict: true,
        esModuleInterop: true,
        module: 'commonjs',
        moduleResolution: 'node',
        target: 'ES2022',
        rootDir: '.',
        skipLibCheck: true,
      },
    }],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/cli/index.ts',
  ],
  testTimeout: 15000,
};

export default config;
