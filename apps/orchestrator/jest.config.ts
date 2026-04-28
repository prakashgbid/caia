import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/packages', '<rootDir>/apps'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dashboard/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Workspace packages live two levels up at <repo>/packages/* in the CAIA
    // monorepo (orchestrator is at apps/orchestrator/). When orchestrator
    // jest is un-stubbed (Batch J cleanup), pnpm workspace symlinks under
    // node_modules should resolve these — these mappers are belt-and-suspenders.
    '^@chiefaia/events-taxonomy-internal$': '<rootDir>/../../packages/events-taxonomy-internal/index.ts',
    '^@chiefaia/event-bus-internal$': '<rootDir>/../../packages/event-bus-internal/index.ts',
    '^@chiefaia/classifier$': '<rootDir>/../../packages/classifier/src/index.ts',
    '^@chiefaia/decomposer$': '<rootDir>/../../packages/decomposer/src/index.ts',
    '^@chiefaia/dedup-engine$': '<rootDir>/../../packages/dedup-engine/src/index.ts',
    '^@chiefaia/ticket-template$': '<rootDir>/../../packages/ticket-template/src/index.ts',
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
