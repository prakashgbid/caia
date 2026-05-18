import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleNameMapper: {
    '^@chiefaia/ticket-template$': '<rootDir>/../../packages/ticket-template/src/index.ts',
    '^@chiefaia/capability-broker$': '<rootDir>/../../packages/capability-broker/src/index.ts',
    // capability-broker pulls in hmac-auth, and worker-coding's logger
    // imports @chiefaia/logger directly. Both of those packages are
    // built as ESM (tsup --format esm), which ts-jest cannot parse with
    // `module: 'commonjs'`. Redirect them to their .ts source so Jest
    // never crosses the ESM boundary.
    '^@chiefaia/hmac-auth$': '<rootDir>/../../packages/hmac-auth/src/index.ts',
    '^@chiefaia/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    '^@chiefaia/tool-output-sanitizer$': '<rootDir>/../../packages/tool-output-sanitizer/src/index.ts',
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
  testTimeout: 15000,
};

export default config;
