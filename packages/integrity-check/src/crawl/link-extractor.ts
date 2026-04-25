import _traverse from '@babel/traverse';
import * as t from '@babel/types';
import * as fs from 'fs';
import fg from 'fast-glob';
import { parseFile, jsxAttrName, jsxElementName } from '../static/ast';

const traverse: typeof _traverse = ((_traverse as unknown as { default?: typeof _traverse }).default ?? _traverse);

export interface ExtractedLink {
  href: string;
  sourceFile: string;
  line: number;
  isExternal: boolean;
}

function isExternal(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://') || href.startsWith('//');
}

/** Extract all static href values from <a> and <Link> elements in a TSX file. */
function extractLinksFromFile(filePath: string): ExtractedLink[] {
  const code = fs.readFileSync(filePath, 'utf8');
  const ast = parseFile(code, filePath);
  if (!ast) return [];

  const links: ExtractedLink[] = [];

  traverse(ast, {
    JSXOpeningElement(path) {
      const name = jsxElementName(path.node.name);
      if (name !== 'a' && name !== 'Link') return;

      const attrs = path.node.attributes.filter(t.isJSXAttribute);
      const hrefAttr = attrs.find((a) => jsxAttrName(a.name) === 'href');
      if (!hrefAttr) return;

      let href: string | null = null;
      if (t.isStringLiteral(hrefAttr.value)) href = hrefAttr.value.value;
      if (
        t.isJSXExpressionContainer(hrefAttr.value) &&
        t.isStringLiteral(hrefAttr.value.expression)
      )
        href = hrefAttr.value.expression.value;

      if (!href || href === '#' || href === '') return; // these are caught by missing-href rule

      links.push({
        href,
        sourceFile: filePath,
        line: hrefAttr.loc?.start.line ?? 0,
        isExternal: isExternal(href),
      });
    },
  });

  return links;
}

/** Extract all links from all source files in a project. */
export async function extractAllLinks(projectDir: string): Promise<ExtractedLink[]> {
  const files = await fg('src/**/*.{ts,tsx,jsx,js}', {
    cwd: projectDir,
    ignore: ['**/node_modules/**', '**/.next/**', '**/out/**'],
    absolute: true,
  });

  const links: ExtractedLink[] = [];
  for (const file of files) {
    links.push(...extractLinksFromFile(file));
  }
  return links;
}
