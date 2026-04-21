import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dashboard/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
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
