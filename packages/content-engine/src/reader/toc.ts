import type { TOCItem } from './types';

export function extractTOC(htmlContent: string): TOCItem[] {
  const items: TOCItem[] = [];
  const re = /<h([23])[^>]*>(.*?)<\/h[23]>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlContent)) !== null) {
    const level = parseInt(m[1]) as 2 | 3;
    const text = m[2].replace(/<[^>]+>/g, '');
    const id = text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    items.push({ id, text, level });
  }
  return items;
}
