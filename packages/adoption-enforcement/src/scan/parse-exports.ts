import { readFileSync } from 'node:fs';

import ts from 'typescript';

import type { DeclKind, ExportRow } from './types.js';

/**
 * Parse the top-level exports of an `index.ts`-style entry file using the
 * TypeScript compiler API.
 *
 * Handles:
 *   - `export function|class|const|let|var|interface|type|enum X ...`
 *   - `export default function|class|<expr>`
 *   - `export { foo, bar as baz, type Quux }` (local export list)
 *   - `export { foo, bar as baz, type Quux } from './m'` (re-export list)
 *   - `export type { Foo } from './m'` (whole-clause type-only re-export)
 *   - `export * as ns from './m'` (namespace re-export)
 *   - destructuring binding patterns in `export const { a, b } = ...`
 *
 * Wildcard `export * from './m'` is intentionally NOT emitted as a row — it
 * has no identifier and is a transparent pass-through.
 */
export function parseExports(indexPath: string): ExportRow[] {
  const source = readFileSync(indexPath, 'utf8');
  return parseExportsFromSource(source, indexPath);
}

export function parseExportsFromSource(source: string, fileName = 'index.ts'): ExportRow[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /*setParents*/ true, ts.ScriptKind.TS);
  const rows: ExportRow[] = [];

  for (const stmt of sf.statements) {
    visitTopLevel(stmt, rows);
  }
  return rows;
}

function visitTopLevel(node: ts.Statement, rows: ExportRow[]): void {
  if (ts.isFunctionDeclaration(node) && hasExportModifier(node)) {
    if (hasDefaultModifier(node)) {
      rows.push({ identifier: 'default', decl_kind: 'default', isTypeOnly: false });
    } else if (node.name) {
      rows.push({ identifier: node.name.text, decl_kind: 'function', isTypeOnly: false });
    }
    return;
  }

  if (ts.isClassDeclaration(node) && hasExportModifier(node)) {
    if (hasDefaultModifier(node)) {
      rows.push({ identifier: 'default', decl_kind: 'default', isTypeOnly: false });
    } else if (node.name) {
      rows.push({ identifier: node.name.text, decl_kind: 'class', isTypeOnly: false });
    }
    return;
  }

  if (ts.isInterfaceDeclaration(node) && hasExportModifier(node)) {
    rows.push({ identifier: node.name.text, decl_kind: 'interface', isTypeOnly: true });
    return;
  }

  if (ts.isTypeAliasDeclaration(node) && hasExportModifier(node)) {
    rows.push({ identifier: node.name.text, decl_kind: 'type', isTypeOnly: true });
    return;
  }

  if (ts.isEnumDeclaration(node) && hasExportModifier(node)) {
    rows.push({ identifier: node.name.text, decl_kind: 'enum', isTypeOnly: false });
    return;
  }

  if (ts.isVariableStatement(node) && hasExportModifier(node)) {
    const kind = variableKind(node.declarationList);
    for (const decl of node.declarationList.declarations) {
      collectBindingNames(decl.name, kind, rows);
    }
    return;
  }

  if (ts.isExportAssignment(node)) {
    // `export default <expr>` (export = is CommonJS, ignored).
    if (node.isExportEquals !== true) {
      rows.push({ identifier: 'default', decl_kind: 'default', isTypeOnly: false });
    }
    return;
  }

  if (ts.isExportDeclaration(node)) {
    visitExportDeclaration(node, rows);
    return;
  }
}

function visitExportDeclaration(node: ts.ExportDeclaration, rows: ExportRow[]): void {
  const isFrom = node.moduleSpecifier !== undefined;
  const clauseTypeOnly = node.isTypeOnly === true;

  if (node.exportClause === undefined) {
    // `export * from './m'` — no identifier rows.
    return;
  }

  if (ts.isNamespaceExport(node.exportClause)) {
    // `export * as ns from './m'`
    rows.push({
      identifier: node.exportClause.name.text,
      decl_kind: 'namespace-re-export',
      isTypeOnly: clauseTypeOnly,
    });
    return;
  }

  // NamedExports: `export { a, b as c, type D } [from '...']`
  for (const spec of node.exportClause.elements) {
    const isTypeOnly = clauseTypeOnly || spec.isTypeOnly === true;
    const identifier = spec.name.text;
    const decl_kind: DeclKind = isFrom ? 're-export' : 're-export';
    rows.push({ identifier, decl_kind, isTypeOnly });
  }
}

function hasExportModifier(node: ts.HasModifiers): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasDefaultModifier(node: ts.HasModifiers): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

function variableKind(list: ts.VariableDeclarationList): 'const' | 'let' | 'var' {
  if ((list.flags & ts.NodeFlags.Const) !== 0) return 'const';
  if ((list.flags & ts.NodeFlags.Let) !== 0) return 'let';
  return 'var';
}

function collectBindingNames(
  name: ts.BindingName,
  kind: 'const' | 'let' | 'var',
  rows: ExportRow[],
): void {
  if (ts.isIdentifier(name)) {
    rows.push({ identifier: name.text, decl_kind: kind, isTypeOnly: false });
    return;
  }
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) {
        collectBindingNames(element.name, kind, rows);
      }
      // OmittedExpression (e.g. `[, b]`) contributes nothing.
    }
  }
}
