import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { File } from '@babel/types';
import type { Issue } from '../../types';
import { jsxAttrName, jsxElementName } from '../ast';

const traverse: typeof _traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse);

function getHrefValue(attrs: t.JSXAttribute[]): string | null | undefined {
  const hrefAttr = attrs.find((a) => jsxAttrName(a.name) === 'href');
  if (!hrefAttr) return undefined; // missing entirely
  if (hrefAttr.value === null) return null; // href without value (rare)
  if (t.isStringLiteral(hrefAttr.value)) return hrefAttr.value.value;
  if (
    t.isJSXExpressionContainer(hrefAttr.value) &&
    t.isStringLiteral(hrefAttr.value.expression)
  )
    return hrefAttr.value.expression.value;
  // Dynamic href (expression) — can't statically verify, skip
  return 'DYNAMIC';
}

function isTogglePattern(attrs: t.JSXAttribute[]): boolean {
  // aria-expanded pattern: elements that legitimately use href="#"
  // to act as collapse/expand toggles — skip flagging these
  return attrs.some(
    (a) =>
      jsxAttrName(a.name) === 'aria-expanded' ||
      jsxAttrName(a.name) === 'aria-controls',
  );
}

/**
 * Flag:
 *   - <a href=""> or <a href="#"> (not an aria-expanded toggle)
 *   - <Link href=""> or <Link href="#">
 *   - <a> or <Link> with no href at all
 */
export function checkMissingHref(ast: File, filePath: string): Issue[] {
  const issues: Issue[] = [];

  traverse(ast, {
    JSXOpeningElement(path) {
      const elem = path.node;
      const name = jsxElementName(elem.name);
      if (name !== 'a' && name !== 'Link') return;

      const attrs = elem.attributes.filter(t.isJSXAttribute);
      const href = getHrefValue(attrs);
      const loc = elem.loc?.start ?? { line: 0, column: 0 };

      if (href === undefined) {
        // Check it also has no onClick (onClick-only anchors are valid in some patterns)
        const hasOnClick = attrs.some((a) => jsxAttrName(a.name) === 'onClick');
        if (!hasOnClick) {
          issues.push({
            rule: 'missing-href',
            severity: 'error',
            file: filePath,
            line: loc.line,
            col: loc.column,
            message: `<${name}> has no href attribute`,
            fix: 'Add href="/target-route" or convert to a <button>',
          });
        }
        return;
      }

      if (href === 'DYNAMIC') return; // skip dynamic hrefs

      if (href === '') {
        issues.push({
          rule: 'missing-href',
          severity: 'error',
          file: filePath,
          line: loc.line,
          col: loc.column,
          message: `<${name} href=""> — empty href`,
          fix: 'Replace with a real URL or href="/"',
        });
        return;
      }

      if (href === '#') {
        if (isTogglePattern(attrs)) return; // legit aria-expanded toggle
        issues.push({
          rule: 'missing-href',
          severity: 'warning',
          file: filePath,
          line: loc.line,
          col: loc.column,
          message: `<${name} href="#"> — placeholder href (goes to page top, not a real destination)`,
          fix: 'Replace with the real URL or convert to a <button> if no navigation is intended',
        });
      }
    },
  });

  return issues;
}
