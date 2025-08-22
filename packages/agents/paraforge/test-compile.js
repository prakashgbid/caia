#!/usr/bin/env node

/**
 * Test compilation script for ParaForge package
 */

const { execSync } = require('child_process');
const path = require('path');

console.log('🔧 Testing TypeScript compilation for ParaForge package...');

try {
  // Check if TypeScript is available
  const tscPath = path.join(__dirname, 'node_modules', '.bin', 'tsc');
  
  console.log('📦 Installing dependencies...');
  execSync('npm install', { stdio: 'inherit', cwd: __dirname });
  
  console.log('🔍 Running TypeScript compiler...');
  execSync('npx tsc --noEmit', { stdio: 'inherit', cwd: __dirname });
  
  console.log('✅ TypeScript compilation successful!');
  
  console.log('🏗️  Building distribution...');
  execSync('npx tsc', { stdio: 'inherit', cwd: __dirname });
  
  console.log('✅ Build completed successfully!');
  
} catch (error) {
  console.error('❌ Compilation failed:', error.message);
  process.exit(1);
}