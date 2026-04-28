import * as t from '@babel/types';
import type { File } from '@babel/types';
import * as fs from 'fs';
import * as path from 'path';
import type { Issue } from '../../types';

const RESOLVABLE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];

function resolveImport(source: string, fromFile: string): boolean {
  const dir = path.dirname(fromFile);
  const abs = path.resolve(dir, source);

  // Exact file
  if (fs.existsSync(abs)) return true;

  // Try extensions
  for (const ext of RESOLVABLE_EXTS) {
    if (fs.existsSync(abs + ext)) return true;
  }

  return false;
}

/**
 * Flag relative imports that don't resolve to existing files.
 * Skips package imports (no leading '.') and path aliases (@/).
 */
export function checkUnresolvedImports(ast: File, filePath: string): Issue[] {
  const issues: Issue[] = [];

  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue;

    const source = node.source.value;
    // Only check relative imports — path aliases and packages are handled by TS/bundler
    if (!source.startsWith('.')) continue;

    if (!resolveImport(source, filePath)) {
      const loc = node.loc?.start ?? { line: 0, column: 0 };
      issues.push({
        rule: 'unresolved-import',
        severity: 'error',
        file: filePath,
        line: loc.line,
        col: loc.column,
        message: `Cannot resolve import "${source}"`,
        fix: 'Fix the import path or delete the unused import',
      });
    }
  }

  return issues;
}
