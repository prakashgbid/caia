#!/usr/bin/env node

/**
 * Package creation script for CAIA monorepo
 * Creates new packages with proper structure and configuration
 * Usage: npm run create:agent my-agent-name
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CAIA_ROOT = path.dirname(path.dirname(__filename));

// Package type configurations
const PACKAGE_CONFIGS = {
  agent: {
    prefix: '@caia/agent-',
    directory: 'packages/agents',
    template: 'agent',
    keywords: ['caia', 'agent', 'ai']
  },
  engine: {
    prefix: '@caia/engine-',
    directory: 'packages/engines',
    template: 'engine',
    keywords: ['caia', 'engine', 'processing']
  },
  util: {
    prefix: '@caia/util-',
    directory: 'packages/utils',
    template: 'util',
    keywords: ['caia', 'utility', 'helper']
  },
  integration: {
    prefix: '@caia/integration-',
    directory: 'packages/integrations',
    template: 'integration',
    keywords: ['caia', 'integration', 'connector']
  },
  module: {
    prefix: '@caia/module-',
    directory: 'packages/modules',
    template: 'module',
    keywords: ['caia', 'module', 'business']
  },
  tool: {
    prefix: '@caia/tool-',
    directory: 'packages/tools',
    template: 'tool',
    keywords: ['caia', 'tool', 'cli']
  }
};

// Template files
const TEMPLATES = {
  'package.json': (config) => ({
    name: config.packageName,
    version: '0.1.0',
    description: config.description,
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    files: ['dist'],
    scripts: {
      build: 'tsc',
      'build:watch': 'tsc --watch',
      test: 'jest',
      'test:watch': 'jest --watch',
      'test:coverage': 'jest --coverage',
      lint: 'eslint src --ext .ts',
      format: 'prettier --write "src/**/*.ts"',
      prepublishOnly: 'npm run build && npm test',
      clean: 'rm -rf dist coverage'
    },
    keywords: config.keywords,
    author: 'CAIA Team',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/caia-ai/caia.git',
      directory: config.directory
    },
    publishConfig: {
      access: 'public'
    },
    dependencies: {},
    devDependencies: {
      '@types/jest': '^29.5.5',
      '@types/node': '^20.8.0',
      jest: '^29.7.0',
      'ts-jest': '^29.1.1',
      typescript: '^5.2.2'
    }
  }),
  
  'tsconfig.json': () => ({
    extends: '../../../tsconfig.base.json',
    compilerOptions: {
      outDir: './dist',
      rootDir: './src'
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist', '**/*.test.ts', '**/*.spec.ts']
  }),
  
  'jest.config.js': () => `module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts'
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  }
};`,
  
  'README.md': (config) => `# ${config.packageName}

${config.description}

## Installation

\`\`\`bash
npm install ${config.packageName}
\`\`\`

## Usage

\`\`\`typescript
import { ${config.className} } from '${config.packageName}';

const ${config.varName} = new ${config.className}();
// Use ${config.varName}
\`\`\`

## API

### ${config.className}

Main class for ${config.name}.

#### Methods

- \`constructor(options?: ${config.className}Options)\` - Create a new instance
- \`execute(input: any): Promise<any>\` - Execute the ${config.type}

## Development

\`\`\`bash
# Install dependencies
npm install

# Build
npm run build

# Test
npm test

# Lint
npm run lint
\`\`\`

## License

MIT © CAIA Team
`,
  
  '.npmignore': () => `src
tsconfig.json
jest.config.js
.eslintrc.js
*.test.ts
*.spec.ts
coverage
.github
*.log
.DS_Store`,
  
  'src/index.ts': (config) => `/**
 * ${config.packageName}
 * ${config.description}
 */

export * from './${config.type}';
export * from './types';
`,
  
  'src/types.ts': (config) => `/**
 * Type definitions for ${config.packageName}
 */

export interface ${config.className}Options {
  /**
   * Enable debug logging
   */
  debug?: boolean;
  
  /**
   * Custom configuration
   */
  config?: Record<string, any>;
}

export interface ${config.className}Result {
  /**
   * Success status
   */
  success: boolean;
  
  /**
   * Result data
   */
  data?: any;
  
  /**
   * Error message if failed
   */
  error?: string;
  
  /**
   * Execution metadata
   */
  metadata?: {
    duration: number;
    timestamp: string;
    [key: string]: any;
  };
}
`,
  
  // Agent template
  'src/agent.ts': (config) => `import { ${config.className}Options, ${config.className}Result } from './types';

/**
 * ${config.className} - ${config.description}
 */
export class ${config.className} {
  private options: ${config.className}Options;
  
  constructor(options: ${config.className}Options = {}) {
    this.options = options;
  }
  
  /**
   * Execute the agent
   */
  async execute(input: any): Promise<${config.className}Result> {
    const startTime = Date.now();
    
    try {
      // Agent implementation here
      const result = await this.process(input);
      
      return {
        success: true,
        data: result,
        metadata: {
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        metadata: {
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }
  }
  
  private async process(input: any): Promise<any> {
    // TODO: Implement agent logic
    if (this.options.debug) {
      console.log('Processing input:', input);
    }
    
    return {
      processed: true,
      input
    };
  }
}
`,
  
  // Engine template
  'src/engine.ts': (config) => `import { ${config.className}Options, ${config.className}Result } from './types';

/**
 * ${config.className} - ${config.description}
 */
export class ${config.className} {
  private options: ${config.className}Options;
  
  constructor(options: ${config.className}Options = {}) {
    this.options = options;
  }
  
  /**
   * Process input through the engine
   */
  async process(input: any): Promise<${config.className}Result> {
    const startTime = Date.now();
    
    try {
      // Engine processing logic here
      const result = await this.transform(input);
      
      return {
        success: true,
        data: result,
        metadata: {
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        metadata: {
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString()
        }
      };
    }
  }
  
  private async transform(input: any): Promise<any> {
    // TODO: Implement engine transformation
    return {
      transformed: true,
      original: input
    };
  }
}
`,
  
  // Utility template
  'src/util.ts': (config) => `/**
 * ${config.className} - ${config.description}
 */

export interface ${config.className}Options {
  [key: string]: any;
}

/**
 * Main utility function
 */
export function ${config.varName}(input: any, options: ${config.className}Options = {}): any {
  // TODO: Implement utility logic
  return {
    processed: true,
    input,
    options
  };
}

/**
 * Async utility function
 */
export async function ${config.varName}Async(
  input: any,
  options: ${config.className}Options = {}
): Promise<any> {
  // TODO: Implement async utility logic
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(${config.varName}(input, options));
    }, 0);
  });
}
`,
  
  // Test template
  'src/__tests__/index.test.ts': (config) => {
    if (config.type === 'util') {
      return `import { ${config.varName}, ${config.varName}Async } from '../${config.type}';

describe('${config.packageName}', () => {
  describe('${config.varName}', () => {
    it('should process input', () => {
      const result = ${config.varName}('test');
      expect(result).toBeDefined();
      expect(result.processed).toBe(true);
    });
  });
  
  describe('${config.varName}Async', () => {
    it('should process input asynchronously', async () => {
      const result = await ${config.varName}Async('test');
      expect(result).toBeDefined();
      expect(result.processed).toBe(true);
    });
  });
});`;
    }
    
    return `import { ${config.className} } from '../${config.type}';

describe('${config.packageName}', () => {
  let ${config.varName}: ${config.className};
  
  beforeEach(() => {
    ${config.varName} = new ${config.className}();
  });
  
  describe('constructor', () => {
    it('should create an instance', () => {
      expect(${config.varName}).toBeInstanceOf(${config.className});
    });
    
    it('should accept options', () => {
      const ${config.varName}WithOptions = new ${config.className}({ debug: true });
      expect(${config.varName}WithOptions).toBeInstanceOf(${config.className});
    });
  });
  
  describe('execute', () => {
    it('should process input successfully', async () => {
      const result = await ${config.varName}.execute('test input');
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });
    
    it('should include metadata', async () => {
      const result = await ${config.varName}.execute('test');
      expect(result.metadata).toBeDefined();
      expect(result.metadata.duration).toBeGreaterThanOrEqual(0);
      expect(result.metadata.timestamp).toBeDefined();
    });
  });
});`;
  }
};

// Helper functions
function toPascalCase(str) {
  return str
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join('');
}

function toCamelCase(str) {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

function createPackage(type, name, description) {
  if (!PACKAGE_CONFIGS[type]) {
    console.error(`❌ Invalid package type: ${type}`);
    console.log(`Valid types: ${Object.keys(PACKAGE_CONFIGS).join(', ')}`);
    process.exit(1);
  }
  
  const config = PACKAGE_CONFIGS[type];
  const packageName = config.prefix + name;
  const className = toPascalCase(name) + toPascalCase(type);
  const varName = toCamelCase(name);
  const packageDir = path.join(CAIA_ROOT, config.directory, name);
  
  // Check if package already exists
  if (fs.existsSync(packageDir)) {
    console.error(`❌ Package already exists: ${packageDir}`);
    process.exit(1);
  }
  
  const packageConfig = {
    type,
    name,
    packageName,
    className,
    varName,
    description: description || `${className} for CAIA`,
    directory: `${config.directory}/${name}`,
    keywords: [...config.keywords, ...name.split('-')]
  };
  
  console.log(`\n🚀 Creating ${type}: ${packageName}`);
  console.log(`📁 Location: ${packageDir}\n`);
  
  // Create directory structure
  const dirs = [
    packageDir,
    path.join(packageDir, 'src'),
    path.join(packageDir, 'src', '__tests__')
  ];
  
  dirs.forEach(dir => {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`  📁 Created: ${path.relative(CAIA_ROOT, dir)}`);
  });
  
  // Create files
  const files = {
    'package.json': JSON.stringify(TEMPLATES['package.json'](packageConfig), null, 2),
    'tsconfig.json': JSON.stringify(TEMPLATES['tsconfig.json'](), null, 2),
    'jest.config.js': TEMPLATES['jest.config.js'](),
    'README.md': TEMPLATES['README.md'](packageConfig),
    '.npmignore': TEMPLATES['.npmignore'](),
    'src/index.ts': TEMPLATES['src/index.ts'](packageConfig),
    'src/types.ts': TEMPLATES['src/types.ts'](packageConfig),
    [`src/${type}.ts`]: TEMPLATES[`src/${type}.ts`] 
      ? TEMPLATES[`src/${type}.ts`](packageConfig)
      : TEMPLATES['src/agent.ts'](packageConfig),
    'src/__tests__/index.test.ts': TEMPLATES['src/__tests__/index.test.ts'](packageConfig)
  };
  
  Object.entries(files).forEach(([filename, content]) => {
    const filepath = path.join(packageDir, filename);
    fs.writeFileSync(filepath, content);
    console.log(`  📄 Created: ${path.relative(CAIA_ROOT, filepath)}`);
  });
  
  console.log(`\n✅ Package created successfully!`);
  console.log(`\n📌 Next steps:`);
  console.log(`  1. cd ${path.relative(process.cwd(), packageDir)}`);
  console.log(`  2. npm install`);
  console.log(`  3. npm run build`);
  console.log(`  4. npm test`);
  console.log(`  5. Implement your ${type} logic in src/${type}.ts`);
  console.log(`\n💡 To use in other packages:`);
  console.log(`  import { ${className} } from '${packageName}';`);
}

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: npm run create:<type> <name> [description]');
    console.log('');
    console.log('Types:');
    Object.keys(PACKAGE_CONFIGS).forEach(type => {
      console.log(`  - ${type}`);
    });
    console.log('');
    console.log('Examples:');
    console.log('  npm run create:agent code-reviewer');
    console.log('  npm run create:engine optimizer "Performance optimization engine"');
    console.log('  npm run create:util logger');
    process.exit(1);
  }
  
  const [type, name, ...descriptionParts] = args;
  const description = descriptionParts.join(' ');
  
  createPackage(type, name, description);
}

module.exports = { createPackage };