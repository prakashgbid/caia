import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { File } from '@babel/types';
import type { Issue } from '../../types';
import { jsxAttrName, jsxElementName } from '../ast';

const traverse: typeof _traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse);

function getAttrStringValue(attr: t.JSXAttribute): string | null {
  if (t.isStringLiteral(attr.value)) return attr.value.value;
  if (
    t.isJSXExpressionContainer(attr.value) &&
    t.isStringLiteral(attr.value.expression)
  )
    return attr.value.expression.value;
  return null;
}

function isInsideForm(path: import('@babel/traverse').NodePath<t.JSXOpeningElement>): boolean {
  let cur: import('@babel/traverse').NodePath | null = path.parentPath;
  while (cur) {
    if (cur.isJSXElement()) {
      const opening = (cur.node as t.JSXElement).openingElement;
      if (jsxElementName(opening.name).toLowerCase() === 'form') return true;
    }
    cur = cur.parentPath;
  }
  return false;
}

/**
 * Flag <button> elements that have no onClick, no type="submit"/"reset",
 * and are not inside a <form>.
 */
export function checkButtonWithoutAction(ast: File, filePath: string): Issue[] {
  const issues: Issue[] = [];

  traverse(ast, {
    JSXOpeningElement(path) {
      const elem = path.node;
      if (jsxElementName(elem.name).toLowerCase() !== 'button') return;

      const attrs = elem.attributes.filter(t.isJSXAttribute);

      const hasOnClick = attrs.some((a) => jsxAttrName(a.name) === 'onClick');
      const hasOnKeyDown = attrs.some((a) => jsxAttrName(a.name) === 'onKeyDown');
      const typeAttr = attrs.find((a) => jsxAttrName(a.name) === 'type');
      const typeVal = typeAttr ? getAttrStringValue(typeAttr) : null;
      const hasSubmitType = typeVal === 'submit' || typeVal === 'reset';
      // Disabled buttons are intentionally non-interactive — skip
      const isDisabled = attrs.some((a) => {
        const n = jsxAttrName(a.name);
        if (n !== 'disabled') return false;
        // disabled={true}, disabled, disabled={someVar} are all OK
        return true;
      });
      // role="tab", role="menuitem" etc. get their handler from parent — skip
      const roleAttr = attrs.find((a) => jsxAttrName(a.name) === 'role');
      const roleVal = roleAttr ? getAttrStringValue(roleAttr) : null;
      const isManagedRole = roleVal === 'tab' || roleVal === 'menuitem' || roleVal === 'option';

      if (hasOnClick || hasOnKeyDown || hasSubmitType || isManagedRole || isDisabled) return;
      if (isInsideForm(path)) return;

      const loc = elem.loc?.start ?? { line: 0, column: 0 };
      issues.push({
        rule: 'button-without-action',
        severity: 'warning',
        file: filePath,
        line: loc.line,
        col: loc.column,
        message: '<button> has no onClick, no type="submit", and is not in a <form>',
        fix: 'Add onClick handler, set type="submit", or change to a non-interactive element',
      });
    },
  });

  return issues;
}
