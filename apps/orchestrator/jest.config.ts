import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dashboard/'],
  transformIgnorePatterns: ['/node_modules/(?!(nanoid|.pnpm/nanoid))'],
  moduleNameMapper: {
    '^nanoid$': '<rootDir>/node_modules/nanoid',
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@chiefaia/events-taxonomy-internal$': '<rootDir>/../../packages/events-taxonomy-internal/index.ts',
    '^@chiefaia/event-bus-internal$': '<rootDir>/../../packages/event-bus-internal/index.ts',
    '^@chiefaia/classifier$': '<rootDir>/../../packages/classifier/src/index.ts',
    '^@chiefaia/decomposer$': '<rootDir>/../../packages/decomposer/src/index.ts',
    '^@chiefaia/dedup-engine$': '<rootDir>/../../packages/dedup-engine/src/index.ts',
    '^@chiefaia/ticket-template$': '<rootDir>/../../packages/ticket-template/src/index.ts',
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
