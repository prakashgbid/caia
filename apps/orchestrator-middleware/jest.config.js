/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          strict: true,
          esModuleInterop: true,
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'ES2022',
          skipLibCheck: true,
        },
      },
    ],
  },
  // Strip .js extension used in source imports so ts-jest can resolve them
  moduleNameMapper: {
    '^(\\.{1,2}/.+)\\.js$': '$1',
  },
};
