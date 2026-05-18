import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '\\.bench\\.ts$'],
  moduleNameMapper: {
    '^@chiefaia/ticket-template$': '<rootDir>/../../packages/ticket-template/src/index.ts',
    // tool-output-sanitizer is ESM-only; redirect to src so ts-jest (CJS) can parse it.
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
