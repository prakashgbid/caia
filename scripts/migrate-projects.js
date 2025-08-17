#!/usr/bin/env node

/**
 * Migration script to reorganize existing projects into CAIA monorepo structure
 * This script will:
 * 1. Move existing projects to appropriate packages/ directories
 * 2. Update package.json files with proper naming
 * 3. Set up inter-package dependencies
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECTS_ROOT = '/Users/MAC/Documents/projects';
const CAIA_ROOT = path.join(PROJECTS_ROOT, 'caia');

// Migration mapping
const MIGRATION_MAP = {
  // Projects to move to packages/integrations
  integrations: {
    'jira-connect': {
      target: 'packages/integrations/jira',
      packageName: '@caia/integration-jira',
      description: 'JIRA integration for CAIA'
    },
    'chatgpt-mcp-server': {
      target: 'packages/integrations/mcp-chatgpt',
      packageName: '@caia/integration-mcp-chatgpt',
      description: 'ChatGPT MCP Server integration'
    },
    'orchestra-platform/packages/core': {
      target: 'packages/integrations/orchestra',
      packageName: '@caia/integration-orchestra',
      description: 'Orchestra LLM consensus integration',
      keepOriginal: true // Don't delete orchestra-platform
    }
  },
  
  // Projects to move to packages/agents
  agents: {
    'paraforge': {
      target: 'packages/agents/paraforge',
      packageName: '@caia/agent-paraforge',
      description: 'Requirements to JIRA transformation agent'
    },
    'autonomous-chatgpt-agent': {
      target: 'packages/agents/chatgpt-autonomous',
      packageName: '@caia/agent-chatgpt-autonomous',
      description: 'Autonomous ChatGPT agent'
    },
    'smart-agents-training-system': {
      target: 'packages/agents/training-system',
      packageName: '@caia/agent-training-system',
      description: 'Multi-agent training and coordination system'
    }
  },
  
  // OmniMind modules to extract
  omnimind: {
    'omnimind/modules/auto-coder': {
      target: 'packages/engines/code-generation',
      packageName: '@caia/engine-code-generation',
      description: 'Automated code generation engine'
    },
    'omnimind/modules/deep-reasoner': {
      target: 'packages/engines/reasoning',
      packageName: '@caia/engine-reasoning',
      description: 'Deep reasoning and analysis engine'
    },
    'omnimind/modules/self-learning': {
      target: 'packages/engines/learning',
      packageName: '@caia/engine-learning',
      description: 'Self-learning and improvement engine'
    },
    'omnimind/modules/smart-planner': {
      target: 'packages/engines/planning',
      packageName: '@caia/engine-planning',
      description: 'Intelligent planning and task decomposition engine'
    },
    'omnimind/modules/langgraph-orchestrator': {
      target: 'packages/engines/workflow',
      packageName: '@caia/engine-workflow',
      description: 'Workflow orchestration engine'
    },
    'omnimind/modules/persistent-ai-memory': {
      target: 'packages/modules/memory',
      packageName: '@caia/module-memory',
      description: 'Persistent memory system for AI agents'
    },
    'omnimind/modules/o-s-a-autonomous': {
      target: 'packages/modules/autonomy',
      packageName: '@caia/module-autonomy',
      description: 'Autonomous operation module'
    }
  },
  
  // Existing CAIA components to reorganize
  caia: {
    'caia/utils/parallel/cc-orchestrator': {
      target: 'packages/utils/cc-orchestrator',
      packageName: '@caia/util-cc-orchestrator',
      description: 'Claude Code orchestrator for parallel execution',
      moveFrom: 'caia/utils/parallel/cc-orchestrator'
    }
  }
};

// Helper functions
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function updatePackageJson(packagePath, updates) {
  const packageJsonPath = path.join(packagePath, 'package.json');
  
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    
    // Update fields
    Object.assign(packageJson, updates);
    
    // Ensure proper repository field
    if (!packageJson.repository) {
      packageJson.repository = {
        type: 'git',
        url: 'https://github.com/caia-ai/caia.git',
        directory: packagePath.replace(CAIA_ROOT + '/', '')
      };
    }
    
    // Add CAIA keywords
    if (!packageJson.keywords) {
      packageJson.keywords = [];
    }
    if (!packageJson.keywords.includes('caia')) {
      packageJson.keywords.unshift('caia');
    }
    
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
    return true;
  }
  
  // Create new package.json if doesn't exist
  const newPackageJson = {
    name: updates.name,
    version: updates.version || '0.1.0',
    description: updates.description,
    main: 'dist/index.js',
    types: 'dist/index.d.ts',
    scripts: {
      build: 'tsc',
      test: 'jest',
      lint: 'eslint src --ext .ts',
      format: 'prettier --write "src/**/*.ts"',
      prepublishOnly: 'npm run build'
    },
    keywords: ['caia', ...updates.keywords || []],
    author: 'CAIA Team',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/caia-ai/caia.git',
      directory: packagePath.replace(CAIA_ROOT + '/', '')
    },
    publishConfig: {
      access: 'public'
    }
  };
  
  fs.writeFileSync(packageJsonPath, JSON.stringify(newPackageJson, null, 2));
  return false;
}

function copyDirectory(src, dest) {
  ensureDir(dest);
  
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    
    // Skip node_modules and other build artifacts
    if (['node_modules', '.git', 'dist', 'build', '.next'].includes(entry.name)) {
      continue;
    }
    
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Main migration function
async function migrate() {
  console.log('🚀 Starting CAIA Monorepo Migration...\n');
  
  const results = {
    migrated: [],
    skipped: [],
    errors: []
  };
  
  // Process each migration category
  for (const [category, projects] of Object.entries(MIGRATION_MAP)) {
    console.log(`\n📦 Processing ${category.toUpperCase()} migrations...`);
    
    for (const [source, config] of Object.entries(projects)) {
      const sourcePath = config.moveFrom 
        ? path.join(PROJECTS_ROOT, config.moveFrom)
        : path.join(PROJECTS_ROOT, source);
      const targetPath = path.join(CAIA_ROOT, config.target);
      
      console.log(`\n  Migrating: ${source}`);
      console.log(`  Target: ${config.target}`);
      
      try {
        // Check if source exists
        if (!fs.existsSync(sourcePath)) {
          console.log(`  ⚠️  Source not found, skipping`);
          results.skipped.push(source);
          continue;
        }
        
        // Check if target already exists
        if (fs.existsSync(targetPath)) {
          console.log(`  ⚠️  Target already exists, skipping`);
          results.skipped.push(source);
          continue;
        }
        
        // Copy source to target
        console.log(`  📂 Copying files...`);
        copyDirectory(sourcePath, targetPath);
        
        // Update package.json
        console.log(`  📝 Updating package.json...`);
        const hadPackageJson = updatePackageJson(targetPath, {
          name: config.packageName,
          description: config.description,
          version: '0.1.0'
        });
        
        if (!hadPackageJson) {
          console.log(`  📄 Created new package.json`);
        }
        
        // Create TypeScript config if needed
        const tsconfigPath = path.join(targetPath, 'tsconfig.json');
        if (!fs.existsSync(tsconfigPath)) {
          const tsconfig = {
            extends: '../../../tsconfig.base.json',
            compilerOptions: {
              outDir: './dist',
              rootDir: './src'
            },
            include: ['src/**/*'],
            exclude: ['node_modules', 'dist', '**/*.test.ts']
          };
          fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
          console.log(`  📄 Created tsconfig.json`);
        }
        
        // Create src directory if it doesn't exist
        const srcDir = path.join(targetPath, 'src');
        if (!fs.existsSync(srcDir)) {
          ensureDir(srcDir);
          
          // Move TypeScript/JavaScript files to src if they're in root
          const files = fs.readdirSync(targetPath);
          for (const file of files) {
            if (file.endsWith('.ts') || file.endsWith('.js')) {
              const filePath = path.join(targetPath, file);
              if (fs.statSync(filePath).isFile()) {
                fs.renameSync(filePath, path.join(srcDir, file));
              }
            }
          }
        }
        
        console.log(`  ✅ Successfully migrated ${source}`);
        results.migrated.push(config.packageName);
        
        // Don't delete original if keepOriginal is true
        if (!config.keepOriginal && !config.moveFrom) {
          console.log(`  🗑️  Original will be removed after confirmation`);
        }
        
      } catch (error) {
        console.error(`  ❌ Error migrating ${source}: ${error.message}`);
        results.errors.push({ source, error: error.message });
      }
    }
  }
  
  // Create shared configs
  console.log('\n📝 Creating shared configuration files...');
  
  // Root TypeScript config
  const rootTsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'commonjs',
      lib: ['ES2022'],
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      moduleResolution: 'node',
      experimentalDecorators: true,
      emitDecoratorMetadata: true
    },
    exclude: ['node_modules', 'dist', 'build', '**/*.test.ts']
  };
  
  fs.writeFileSync(
    path.join(CAIA_ROOT, 'tsconfig.base.json'),
    JSON.stringify(rootTsConfig, null, 2)
  );
  console.log('  ✅ Created tsconfig.base.json');
  
  // Root ESLint config
  const eslintConfig = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'import', 'jest'],
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:jest/recommended',
      'prettier'
    ],
    env: {
      node: true,
      jest: true,
      es2022: true
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'import/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always'
      }]
    }
  };
  
  fs.writeFileSync(
    path.join(CAIA_ROOT, '.eslintrc.js'),
    `module.exports = ${JSON.stringify(eslintConfig, null, 2)}`
  );
  console.log('  ✅ Created .eslintrc.js');
  
  // Prettier config
  const prettierConfig = {
    semi: true,
    trailingComma: 'es5',
    singleQuote: true,
    printWidth: 100,
    tabWidth: 2,
    useTabs: false
  };
  
  fs.writeFileSync(
    path.join(CAIA_ROOT, '.prettierrc'),
    JSON.stringify(prettierConfig, null, 2)
  );
  console.log('  ✅ Created .prettierrc');
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 MIGRATION SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Successfully migrated: ${results.migrated.length} packages`);
  if (results.migrated.length > 0) {
    results.migrated.forEach(pkg => console.log(`   - ${pkg}`));
  }
  
  if (results.skipped.length > 0) {
    console.log(`\n⚠️  Skipped: ${results.skipped.length} projects`);
    results.skipped.forEach(pkg => console.log(`   - ${pkg}`));
  }
  
  if (results.errors.length > 0) {
    console.log(`\n❌ Errors: ${results.errors.length}`);
    results.errors.forEach(({ source, error }) => {
      console.log(`   - ${source}: ${error}`);
    });
  }
  
  console.log('\n📌 Next Steps:');
  console.log('1. Review migrated packages in packages/ directory');
  console.log('2. Run: cd caia && npm install');
  console.log('3. Run: npm run bootstrap');
  console.log('4. Run: npm run build');
  console.log('5. Test packages: npm test');
  console.log('6. Remove original directories if migration successful');
  
  // Save migration log
  const logPath = path.join(CAIA_ROOT, 'migration.log');
  fs.writeFileSync(logPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    results
  }, null, 2));
  console.log(`\n📁 Migration log saved to: ${logPath}`);
}

// Run migration
if (require.main === module) {
  migrate().catch(console.error);
}

module.exports = { migrate };