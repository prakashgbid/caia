import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { File } from '@babel/types';
import type { Issue } from '../../types';
import { jsxAttrName } from '../ast';

const traverse: typeof _traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse);

/** Recursively collect identifier names from a function parameter node. */
function collectParamNames(param: t.Node, names: Set<string>): void {
  if (t.isIdentifier(param)) {
    names.add(param.name);
  } else if (t.isObjectPattern(param)) {
    for (const prop of param.properties) {
      if (t.isObjectProperty(prop)) {
        // { foo } or { foo: bar }
        collectParamNames(prop.value, names);
      } else if (t.isRestElement(prop)) {
        collectParamNames(prop.argument, names);
      }
    }
  } else if (t.isArrayPattern(param)) {
    for (const el of param.elements) {
      if (el) collectParamNames(el, names);
    }
  } else if (t.isAssignmentPattern(param)) {
    // { foo = defaultVal }
    collectParamNames(param.left, names);
  } else if (t.isRestElement(param)) {
    collectParamNames(param.argument, names);
  }
}

/** Collect every identifier that is declared, imported, or received as a prop in this file. */
function collectDeclaredNames(ast: File): Set<string> {
  const names = new Set<string>();

  traverse(ast, {
    ImportDefaultSpecifier(p) { names.add(p.node.local.name); },
    ImportSpecifier(p) { names.add(p.node.local.name); },
    ImportNamespaceSpecifier(p) { names.add(p.node.local.name); },

    VariableDeclarator(p) {
      collectParamNames(p.node.id, names);
    },

    FunctionDeclaration(p) {
      if (p.node.id) names.add(p.node.id.name);
      for (const param of p.node.params) collectParamNames(param, names);
    },

    FunctionExpression(p) {
      for (const param of p.node.params) collectParamNames(param, names);
    },

    ArrowFunctionExpression(p) {
      for (const param of p.node.params) collectParamNames(param, names);
    },
  });

  return names;
}

const EVENT_ATTRS = new Set([
  'onClick', 'onChange', 'onSubmit', 'onKeyDown', 'onKeyUp', 'onKeyPress',
  'onFocus', 'onBlur', 'onMouseDown', 'onMouseUp', 'onMouseEnter', 'onMouseLeave',
  'onDoubleClick', 'onContextMenu', 'onScroll', 'onWheel', 'onTouchStart',
  'onTouchEnd', 'onDrop', 'onDragOver', 'onDragStart',
]);

/**
 * Flag event handlers that reference an identifier not defined in the file.
 * Only flags Identifier references (not inline functions/arrows — those are caught by dead-onclick).
 */
export function checkUnknownHandlers(ast: File, filePath: string): Issue[] {
  const issues: Issue[] = [];
  const declared = collectDeclaredNames(ast);

  const GLOBALS = new Set([
    'console', 'window', 'document', 'process', 'undefined', 'null', 'true', 'false',
  ]);

  traverse(ast, {
    JSXAttribute(path) {
      const attr = path.node;
      if (!t.isJSXIdentifier(attr.name)) return;
      if (!EVENT_ATTRS.has(attr.name.name)) return;
      if (!t.isJSXExpressionContainer(attr.value)) return;

      const expr = attr.value.expression;
      if (!t.isIdentifier(expr)) return;

      const handlerName = expr.name;
      if (GLOBALS.has(handlerName)) return;
      if (declared.has(handlerName)) return;

      const loc = attr.loc?.start ?? { line: 0, column: 0 };
      issues.push({
        rule: 'unknown-handler',
        severity: 'error',
        file: filePath,
        line: loc.line,
        col: loc.column,
        message: `${attr.name.name}={${handlerName}} — "${handlerName}" is not defined in this file`,
        fix: `Declare "${handlerName}" or import it, or remove the handler`,
      });
    },
  });

  return issues;
}
