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
    '^@chiefaia/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    '^@chiefaia/feature-registry$': '<rootDir>/../../packages/feature-registry/src/index.ts',
    '^@chiefaia/agent-contract-registry$': '<rootDir>/../../packages/agent-contract-registry/src/index.ts',
    '^@chiefaia/architecture-registry$': '<rootDir>/../../packages/architecture-registry/src/index.ts',
    '^@chiefaia/local-llm-router$': '<rootDir>/../../packages/local-llm-router/src/index.ts',
    '^@chiefaia/local-rag$': '<rootDir>/../../packages/local-rag/src/index.ts',
    '^@chiefaia/llm-cache$': '<rootDir>/../../packages/llm-cache/src/index.ts',
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
