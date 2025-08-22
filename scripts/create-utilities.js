#!/usr/bin/env node

/**
 * Script to create all utility packages in parallel
 * Uses CCO principles for maximum efficiency
 */

const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const UTILITIES = [
  {
    name: 'work-divider',
    description: 'Intelligent work distribution engine for parallel task execution',
    keywords: ['work', 'distribution', 'parallel', 'sharding', 'load-balancing']
  },
  {
    name: 'resource-calculator',
    description: 'System resource analysis and optimization calculator',
    keywords: ['resources', 'memory', 'cpu', 'optimization', 'calculation']
  },
  {
    name: 'coverage-aggregator',
    description: 'Universal coverage merging and analysis tool',
    keywords: ['coverage', 'testing', 'aggregation', 'lcov', 'istanbul']
  },
  {
    name: 'metric-collector',
    description: 'Universal metrics gathering and analysis system',
    keywords: ['metrics', 'monitoring', 'performance', 'analytics', 'telemetry']
  },
  {
    name: 'progress-tracker',
    description: 'Real-time progress monitoring and reporting',
    keywords: ['progress', 'tracking', 'monitoring', 'real-time', 'reporting']
  },
  {
    name: 'task-scheduler',
    description: 'Intelligent task scheduling and prioritization',
    keywords: ['scheduler', 'tasks', 'priority', 'queue', 'orchestration']
  },
  {
    name: 'dependency-analyzer',
    description: 'Dependency graph analysis and optimization',
    keywords: ['dependencies', 'graph', 'analysis', 'circular', 'optimization']
  },
  {
    name: 'report-generator',
    description: 'Universal report generation engine',
    keywords: ['reports', 'generation', 'html', 'json', 'xml', 'pdf']
  },
  {
    name: 'pattern-recognizer',
    description: 'ML-based pattern detection and analysis',
    keywords: ['patterns', 'ml', 'ai', 'detection', 'analysis', 'prediction']
  }
];

async function createUtilityPackage(utility) {
  const packageDir = path.join(__dirname, '..', 'packages', 'utils', utility.name);
  
  // Create package.json
  const packageJson = {
    name: `@caia/${utility.name}`,
    version: '0.1.0',
    description: utility.description,
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      build: 'tsc',
      test: 'jest',
      'test:coverage': 'jest --coverage',
      lint: 'npx eslint src --ext .ts',
      'lint:fix': 'npx eslint src --ext .ts --fix',
      format: 'prettier --write "src/**/*.ts"',
      typecheck: 'tsc --noEmit',
      prepublishOnly: 'npm run build'
    },
    keywords: ['caia', ...utility.keywords],
    author: 'CAIA Team',
    license: 'MIT',
    devDependencies: {
      '@types/node': '^20.10.0',
      '@typescript-eslint/eslint-plugin': '^6.21.0',
      '@typescript-eslint/parser': '^6.21.0',
      'eslint': '^8.57.1',
      'jest': '^29.7.0',
      'prettier': '^3.1.0',
      'ts-jest': '^29.1.1',
      'typescript': '^5.3.0'
    },
    publishConfig: {
      access: 'public'
    },
    repository: {
      type: 'git',
      url: 'https://github.com/caia-ai/caia.git',
      directory: `packages/utils/${utility.name}`
    }
  };

  // Add specific dependencies based on utility
  if (utility.name === 'coverage-aggregator') {
    packageJson.dependencies = {
      'istanbul-lib-coverage': '^3.2.0',
      'istanbul-lib-report': '^3.0.1',
      'istanbul-reports': '^3.1.5'
    };
  } else if (utility.name === 'metric-collector') {
    packageJson.dependencies = {
      'prom-client': '^15.0.0'
    };
  } else if (utility.name === 'progress-tracker') {
    packageJson.dependencies = {
      'cli-progress': '^3.12.0',
      'chalk': '^5.3.0'
    };
  } else if (utility.name === 'pattern-recognizer') {
    packageJson.dependencies = {
      'ml-matrix': '^6.10.0',
      'ml-knn': '^3.0.0'
    };
  }

  await fs.writeFile(
    path.join(packageDir, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // Create tsconfig.json
  const tsConfig = {
    extends: '../../../tsconfig.json',
    compilerOptions: {
      rootDir: './src',
      outDir: './dist',
      declaration: true,
      declarationMap: true
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist', '**/*.test.ts']
  };

  await fs.writeFile(
    path.join(packageDir, 'tsconfig.json'),
    JSON.stringify(tsConfig, null, 2)
  );

  // Create .eslintrc.js
  const eslintConfig = `module.exports = {
  root: false,
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_'
      }
    ]
  },
  ignorePatterns: ['dist/', 'node_modules/']
};
`;

  await fs.writeFile(
    path.join(packageDir, '.eslintrc.js'),
    eslintConfig
  );

  // Create jest.config.js
  const jestConfig = `module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.d.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95
    }
  }
};
`;

  await fs.writeFile(
    path.join(packageDir, 'jest.config.js'),
    jestConfig
  );

  // Create README.md
  const readme = `# @caia/${utility.name}

${utility.description}

## Installation

\`\`\`bash
npm install @caia/${utility.name}
\`\`\`

## Usage

\`\`\`typescript
import { ${utility.name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')} } from '@caia/${utility.name}';

// Usage examples coming soon
\`\`\`

## API Documentation

Coming soon...

## License

MIT
`;

  await fs.writeFile(
    path.join(packageDir, 'README.md'),
    readme
  );

  console.log(`✅ Created ${utility.name} package structure`);
}

async function main() {
  console.log('🚀 Creating utility packages in parallel...\n');
  
  // Create all packages in parallel
  const startTime = Date.now();
  
  await Promise.all(UTILITIES.map(createUtilityPackage));
  
  const duration = Date.now() - startTime;
  console.log(`\n✨ All ${UTILITIES.length} utility packages created in ${duration}ms`);
  console.log('📦 Packages created:');
  UTILITIES.forEach(u => console.log(`   - @caia/${u.name}`));
}

main().catch(console.error);