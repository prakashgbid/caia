import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { File } from '@babel/types';
import type { Issue } from '../../types';
import { jsxAttrName } from '../ast';

// Handle CJS/ESM interop for @babel/traverse
const traverse: typeof _traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse);

function isEmptyBody(fn: t.ArrowFunctionExpression | t.FunctionExpression): boolean {
  const { body } = fn;
  if (t.isBlockStatement(body) && body.body.length === 0) return true;
  // () => undefined / () => void 0
  if (t.isIdentifier(body) && body.name === 'undefined') return true;
  if (t.isUnaryExpression(body) && body.operator === 'void') return true;
  return false;
}

/**
 * Flag onClick handlers that do nothing:
 *   - onClick={() => {}}
 *   - onClick={() => undefined}
 *   - onClick={noop} / onClick={NOOP}
 */
export function checkDeadOnClick(ast: File, filePath: string): Issue[] {
  const issues: Issue[] = [];

  traverse(ast, {
    JSXAttribute(path) {
      const attr = path.node;
      if (!t.isJSXIdentifier(attr.name)) return;
      if (attr.name.name !== 'onClick') return;
      if (!t.isJSXExpressionContainer(attr.value)) return;

      const expr = attr.value.expression;
      const loc = attr.loc?.start ?? { line: 0, column: 0 };

      if (
        (t.isArrowFunctionExpression(expr) || t.isFunctionExpression(expr)) &&
        isEmptyBody(expr)
      ) {
        issues.push({
          rule: 'dead-onclick',
          severity: 'error',
          file: filePath,
          line: loc.line,
          col: loc.column,
          message: 'onClick handler is empty — does nothing',
          fix: 'Remove the onClick attribute or add a real handler',
        });
      }

      if (t.isIdentifier(expr) && /^noop$/i.test(expr.name)) {
        issues.push({
          rule: 'dead-onclick',
          severity: 'warning',
          file: filePath,
          line: loc.line,
          col: loc.column,
          message: `onClick references "${expr.name}" — likely a placeholder no-op`,
          fix: 'Replace with a real handler or remove onClick',
        });
      }
    },
  });

  return issues;
}
