import { describe, expect, it } from 'vitest';
import { parseJsxToRenderableDesign } from '../src/parse-jsx.js';
import { AtlasMapperError } from '../src/errors.js';
import { assignStableDomIds } from '../src/assign-stable-dom-ids.js';
import { buildDomIdMap } from '../src/dom-id-map.js';

const TINY = `
function Home() {
  return (
    <div className="pt">
      <PtNav />
      <section className="hero">
        <h1>Welcome</h1>
      </section>
    </div>
  );
}
`;

describe('parseJsxToRenderableDesign', () => {
  it('parses a minimal JSX function component into a RenderableDesign', () => {
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_x',
      files: [{ filePath: 'home.jsx', source: TINY, routePath: '/' }],
    });
    expect(rd.designVersionId).toBe('dv_x');
    expect(rd.routes[0]?.path).toBe('/');
    const tree = rd.componentTrees['tree:root']!;
    expect(tree.node.tag).toBe('div');
    expect(tree.node.role).toBe('page');
    expect(tree.node.children?.[0]?.tag).toBe('PtNav');
    expect(tree.node.children?.[0]?.role).toBe('widget');
    expect(tree.node.children?.[1]?.tag).toBe('section');
    expect(tree.node.children?.[1]?.role).toBe('section');
  });

  it('extracts string + numeric + boolean attribute values', () => {
    const src = `function X(){return <div id="hero" data-count={3} hidden />}`;
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_x',
      files: [{ filePath: 'x.jsx', source: src, routePath: '/x' }],
    });
    const node = rd.componentTrees['tree:x']!.node;
    expect(node.attrs?.id).toBe('hero');
    expect(node.attrs?.['data-count']).toBe(3);
    expect(node.attrs?.hidden).toBe(true);
  });

  it('extracts object literals for style props', () => {
    const src = `function X(){return <div style={{padding: "40px", fontSize: 22}} />}`;
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_x',
      files: [{ filePath: 'x.jsx', source: src, routePath: '/x' }],
    });
    const node = rd.componentTrees['tree:x']!.node;
    expect(node.attrs?.style).toEqual({ padding: '40px', fontSize: 22 });
  });

  it('collects plain text children into copyRefs', () => {
    const src = `function X(){return <h1>Hello World</h1>}`;
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_x',
      files: [{ filePath: 'x.jsx', source: src, routePath: '/x' }],
    });
    const node = rd.componentTrees['tree:x']!.node;
    expect(node.copyRefs?.length).toBe(1);
    expect(rd.copy?.[0]?.text).toContain('Hello World');
  });

  it('feeds into assignStableDomIds + buildDomIdMap without error', () => {
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_x',
      files: [{ filePath: 'home.jsx', source: TINY, routePath: '/' }],
    });
    const stabilised = assignStableDomIds(rd);
    const map = buildDomIdMap(stabilised);
    expect(map.entries.length).toBeGreaterThan(0);
  });

  it('handles self-closing JSX elements', () => {
    const src = `function X(){return <PtNav active="/" />}`;
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_x',
      files: [{ filePath: 'x.jsx', source: src, routePath: '/x' }],
    });
    const node = rd.componentTrees['tree:x']!.node;
    expect(node.tag).toBe('PtNav');
    expect(node.attrs?.active).toBe('/');
  });

  it('throws jsx_parse_error when there is no JSX root', () => {
    expect(() =>
      parseJsxToRenderableDesign({
        designVersionId: 'dv_x',
        files: [{ filePath: 'x.jsx', source: 'const x = 1;', routePath: '/x' }],
      }),
    ).toThrowError(AtlasMapperError);
  });

  it('throws jsx_parse_error on empty file list', () => {
    expect(() =>
      parseJsxToRenderableDesign({ designVersionId: 'dv_x', files: [] }),
    ).toThrowError(/files\[\] must be non-empty/);
  });

  it('is deterministic — same source → same output', () => {
    const a = parseJsxToRenderableDesign({
      designVersionId: 'dv_x',
      files: [{ filePath: 'home.jsx', source: TINY, routePath: '/' }],
    });
    const b = parseJsxToRenderableDesign({
      designVersionId: 'dv_x',
      files: [{ filePath: 'home.jsx', source: TINY, routePath: '/' }],
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('processes multiple files into one design with multiple routes', () => {
    const rd = parseJsxToRenderableDesign({
      designVersionId: 'dv_x',
      files: [
        { filePath: 'home.jsx', source: TINY, routePath: '/' },
        {
          filePath: 'about.jsx',
          source: 'function A(){return <div className="about" />}',
          routePath: '/about',
        },
      ],
    });
    expect(rd.routes.length).toBe(2);
    expect(rd.componentTrees['tree:root']).toBeDefined();
    expect(rd.componentTrees['tree:about']).toBeDefined();
  });
});
