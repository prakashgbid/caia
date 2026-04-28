import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { 'cli/index': 'src/cli/index.ts' },
    format: ['esm'],
    target: 'node20',
    clean: false,
    splitting: false,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
    external: ['sharp', 'tesseract.js', '@xenova/transformers'],
    outDir: 'dist',
  },
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    target: 'node20',
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    external: ['sharp', 'tesseract.js', '@xenova/transformers'],
    outDir: 'dist',
  },
]);
