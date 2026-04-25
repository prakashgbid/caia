import * as parser from '@babel/parser';
import type { File } from '@babel/types';

/**
 * Parse a TSX/TS/JSX/JS file to a Babel AST.
 * Returns null if parse fails (we skip unparseable files rather than crashing).
 */
export function parseFile(code: string, filePath: string): File | null {
  try {
    return parser.parse(code, {
      sourceType: 'module',
      strictMode: false,
      plugins: [
        'typescript',
        'jsx',
        'decorators-legacy',
        'optionalChaining',
        'nullishCoalescingOperator',
        'classProperties',
      ] as parser.ParserPlugin[],
      attachComment: true,
    });
  } catch {
    process.stderr.write(`[integrity] parse failed: ${filePath}\n`);
    return null;
  }
}

/** Extract JSX attribute name as a plain string */
export function jsxAttrName(node: import('@babel/types').JSXAttribute['name']): string {
  if (node.type === 'JSXIdentifier') return node.name;
  return `${node.namespace.name}:${node.name.name}`;
}

/** Get element name from JSXOpeningElement.name */
export function jsxElementName(
  node:
    | import('@babel/types').JSXIdentifier
    | import('@babel/types').JSXMemberExpression
    | import('@babel/types').JSXNamespacedName,
): string {
  if (node.type === 'JSXIdentifier') return node.name;
  if (node.type === 'JSXMemberExpression') {
    return `${jsxElementName(node.object)}.${node.property.name}`;
  }
  return `${node.namespace.name}:${node.name.name}`;
}
