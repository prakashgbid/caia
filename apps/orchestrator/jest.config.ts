import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests', '<rootDir>/packages', '<rootDir>/apps'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/dashboard/'],
  // nanoid v5 (used by @chiefaia/decomposer) ships ESM-only and breaks
  // ts-jest's CJS transformer. Allow node_modules/nanoid to be transformed.
  transformIgnorePatterns: ['/node_modules/(?!(nanoid|.pnpm/nanoid))'],
  moduleNameMapper: {
    // Force decomposer (which depends on nanoid v5) to use the orchestrator's
    // nanoid v3 (CJS-friendly) so jest can parse the package without a custom
    // ESM transform.
    '^nanoid$': '<rootDir>/node_modules/nanoid',
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
    '^@chiefaia/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    '^@chiefaia/feature-registry$': '<rootDir>/../../packages/feature-registry/src/index.ts',
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
