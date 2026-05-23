/**
 * Minimal JSX → `RenderableDesign` parser using ts-morph.
 *
 * # Scope
 *
 * atlas-mapper's main consumer is downstream of step-5 adapters that
 * produce `RenderableDesign` directly. This module is the in-package
 * helper that lets golden tests + ad-hoc CLI usage convert raw JSX
 * source (the prakash-tiwari CD-ZIP fixture) into a `RenderableDesign`
 * without requiring the full step-5 adapter pipeline.
 *
 * Production adapters (CD-ZIP/Figma/v0/etc.) emit `RenderableDesign`
 * directly with richer fidelity. We do NOT try to match their depth
 * here — this parser captures structure only:
 *
 *   - JSX element tag (component name or HTML tag)
 *   - sibling order
 *   - props (attrs that are static strings, numbers, booleans, or
 *     simple object literals)
 *   - text children (collected into copyRefs / a synthetic copy table)
 *
 * It does NOT evaluate `{expressions}`, resolve imports, or follow
 * component references — that's the step-5 adapter's job.
 *
 * # Why ts-morph
 *
 * Spec §2.2 specifies AST walking. ts-morph is the lib the rest of
 * CAIA uses (`@chiefaia/architecture-registry` etc.) and handles
 * JSX cleanly. We re-use its parser rather than rolling our own.
 *
 * # Determinism contract
 *
 * The parser emits children in source order, preserves whitespace-
 * trimmed text verbatim, and never inspects file mtimes / paths in
 * the node bodies. Same source → same `RenderableDesign`.
 */

import { Project, type SourceFile, ScriptKind, SyntaxKind, Node } from 'ts-morph';
import { AtlasMapperError } from './errors.js';
import type {
  NodeRole,
  RenderableComponentTree,
  RenderableCopy,
  RenderableDesign,
  RenderableNode,
  RenderableRoute,
} from './renderable-design.js';

/**
 * Per-file input. The caller supplies the source text directly so the
 * parser remains decoupled from the filesystem — keeps tests fast and
 * the function itself a pure transform.
 */
export interface ParseJsxFileInput {
  filePath: string;
  source: string;
  /** The route this file renders (e.g. `/`, `/about`). */
  routePath: string;
  /** Optional friendly title for the route. */
  routeTitle?: string;
  /** Optional explicit `componentTreeId`; defaults to a slug of the route. */
  componentTreeId?: string;
}

/** Multi-file input — the prakash-tiwari fixture has 21 page JSX files. */
export interface ParseJsxInput {
  designVersionId: string;
  files: ParseJsxFileInput[];
  /** Optional source label (e.g. `"cd-zip"`). */
  source?: string;
}

/**
 * Heuristic: a tag is a "component" if its name starts with an
 * uppercase letter. Lowercase tags are HTML. This matches React's
 * own JSX-vs-component disambiguation rule.
 */
function isComponentTag(tag: string): boolean {
  return /^[A-Z]/.test(tag);
}

/**
 * Decide the `NodeRole` for a JSX element based on its tag + nesting
 * context. The heuristics are deliberately conservative:
 *
 *   - root element of a file → `page`
 *   - HTML `<section>` or `<header>` / `<footer>` → `section`
 *   - components (PascalCase) → `widget`
 *   - everything else (`<div>`, `<span>`, `<p>` …) → `leaf` unless
 *     we're already inside a widget (in which case we stay `leaf`).
 *
 * This is good enough for fingerprinting; downstream adapters can
 * refine roles in production.
 */
function deriveRole(tag: string, depth: number): NodeRole {
  if (depth === 0) return 'page';
  if (tag === 'section' || tag === 'header' || tag === 'footer' || tag === 'nav' || tag === 'main')
    return 'section';
  if (isComponentTag(tag)) return 'widget';
  return 'leaf';
}

/**
 * Convert a JSX attribute literal value into a JS primitive. Returns
 * `undefined` for anything we don't statically understand — the
 * caller drops `undefined` so the props bag stays clean.
 */
function extractAttrValue(node: Node | undefined): unknown {
  if (!node) return true; // bare attribute (e.g. `<input disabled />`)
  return extractExprValue(node);
}

/**
 * Convert any expression-like node (JsxExpression wrapper, raw
 * literal, object literal property initializer, etc.) into a JS
 * primitive. Returns `undefined` when the value can't be statically
 * resolved.
 */
function extractExprValue(node: Node): unknown {
  if (node.isKind(SyntaxKind.JsxExpression)) {
    const expr = node.getExpression();
    return expr ? extractExprValue(expr) : undefined;
  }
  if (node.isKind(SyntaxKind.StringLiteral)) return node.getLiteralValue();
  if (node.isKind(SyntaxKind.NumericLiteral)) return Number(node.getLiteralValue());
  if (node.isKind(SyntaxKind.TrueKeyword)) return true;
  if (node.isKind(SyntaxKind.FalseKeyword)) return false;
  if (node.isKind(SyntaxKind.NullKeyword)) return null;
  if (node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) return node.getLiteralValue();
  if (node.isKind(SyntaxKind.ObjectLiteralExpression)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.getProperties()) {
      if (prop.isKind(SyntaxKind.PropertyAssignment)) {
        const key = prop.getName();
        const init = prop.getInitializer();
        if (!init) continue;
        const v = extractExprValue(init);
        if (v !== undefined) out[key] = v;
      }
    }
    return out;
  }
  if (node.isKind(SyntaxKind.PrefixUnaryExpression)) {
    // Handle negative numeric literals (e.g. `-2`) which arrive as a
    // PrefixUnaryExpression wrapping a NumericLiteral.
    const operand = node.getOperand();
    const operandValue = extractExprValue(operand);
    if (typeof operandValue === 'number') return -operandValue;
  }
  // Anything else (call expressions, identifiers, ternaries) — mark
  // with a synthetic placeholder so the diff still notices when the
  // SOURCE shape changes, but we don't pretend to evaluate it.
  return '<expr>';
}

/**
 * Collect plain text children from a JSX element (no expressions).
 * Trimmed; multiple whitespace-only text nodes are skipped.
 */
function collectText(children: Node[]): string {
  const parts: string[] = [];
  for (const c of children) {
    if (c.isKind(SyntaxKind.JsxText)) {
      const t = c.getText().trim();
      if (t.length > 0) parts.push(t);
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ');
}

/**
 * Walk a JSX element subtree and produce a `RenderableNode` tree.
 * `copy[]` is mutated as we go — each non-empty text run becomes a
 * synthetic copy entry whose `domId` is computed later (we patch it
 * in once stable IDs exist).
 */
function jsxToNode(
  node: Node,
  depth: number,
  copyAccumulator: Array<{ tempKey: string; text: string }>,
  treeId: string,
  siblingCounter: { n: number },
): RenderableNode | null {
  let tag: string;
  let attrs: Record<string, unknown> = {};
  let children: Node[] = [];

  if (node.isKind(SyntaxKind.JsxElement)) {
    const opening = node.getOpeningElement();
    tag = opening.getTagNameNode().getText();
    for (const attr of opening.getAttributes()) {
      if (attr.isKind(SyntaxKind.JsxAttribute)) {
        const name = attr.getNameNode().getText();
        const initializer = attr.getInitializer();
        const v = extractAttrValue(initializer);
        if (v !== undefined) attrs[name] = v;
      }
    }
    children = node.getJsxChildren();
  } else if (node.isKind(SyntaxKind.JsxSelfClosingElement)) {
    tag = node.getTagNameNode().getText();
    for (const attr of node.getAttributes()) {
      if (attr.isKind(SyntaxKind.JsxAttribute)) {
        const name = attr.getNameNode().getText();
        const initializer = attr.getInitializer();
        const v = extractAttrValue(initializer);
        if (v !== undefined) attrs[name] = v;
      }
    }
    children = [];
  } else {
    return null;
  }

  const role = deriveRole(tag, depth);
  const rNode: RenderableNode = { tag, role, attrs };

  const text = collectText(children);
  if (text.length > 0) {
    const tempKey = `${treeId}:copy:${siblingCounter.n++}`;
    copyAccumulator.push({ tempKey, text });
    rNode.copyRefs = [tempKey];
  }

  // Recurse into JSX-element children only; skip text and expressions.
  const kidNodes: RenderableNode[] = [];
  for (const c of children) {
    if (c.isKind(SyntaxKind.JsxElement) || c.isKind(SyntaxKind.JsxSelfClosingElement)) {
      const k = jsxToNode(c, depth + 1, copyAccumulator, treeId, siblingCounter);
      if (k) kidNodes.push(k);
    } else if (c.isKind(SyntaxKind.JsxFragment)) {
      // Treat fragments as transparent — their children become this
      // node's children. Common in modern JSX.
      for (const fragChild of c.getJsxChildren()) {
        if (
          fragChild.isKind(SyntaxKind.JsxElement) ||
          fragChild.isKind(SyntaxKind.JsxSelfClosingElement)
        ) {
          const k = jsxToNode(fragChild, depth + 1, copyAccumulator, treeId, siblingCounter);
          if (k) kidNodes.push(k);
        }
      }
    }
  }
  if (kidNodes.length > 0) rNode.children = kidNodes;
  return rNode;
}

/**
 * Find the first JSX element returned from the file. The CD-ZIP
 * fixture files declare `function HomeDesktop() { return ( <div...> ) }`
 * — we just want that returned JSX expression.
 *
 * Strategy: scan for the first `ReturnStatement` whose expression is a
 * JsxElement or JsxSelfClosingElement, OR an arrow-function whose body
 * is one. Falls back to the first JSX expression anywhere in the file.
 */
function findRootJsx(source: SourceFile): Node | null {
  // Pass 1: return statements.
  const returns = source.getDescendantsOfKind(SyntaxKind.ReturnStatement);
  for (const r of returns) {
    const expr = r.getExpression();
    if (!expr) continue;
    if (
      expr.isKind(SyntaxKind.JsxElement) ||
      expr.isKind(SyntaxKind.JsxSelfClosingElement) ||
      expr.isKind(SyntaxKind.JsxFragment)
    ) {
      return expr;
    }
    if (expr.isKind(SyntaxKind.ParenthesizedExpression)) {
      const inner = expr.getExpression();
      if (
        inner.isKind(SyntaxKind.JsxElement) ||
        inner.isKind(SyntaxKind.JsxSelfClosingElement) ||
        inner.isKind(SyntaxKind.JsxFragment)
      ) {
        return inner;
      }
    }
  }
  // Pass 2: any top-level JSX.
  const els = source.getDescendantsOfKind(SyntaxKind.JsxElement);
  if (els.length > 0) return els[0] ?? null;
  const sels = source.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement);
  if (sels.length > 0) return sels[0] ?? null;
  return null;
}

/**
 * Slug a route path to a `componentTreeId` when the caller didn't
 * supply one. `/` → `tree:root`, `/about` → `tree:about`.
 */
function defaultTreeId(routePath: string): string {
  const slug = routePath.replace(/^\//, '').replace(/\//g, '-') || 'root';
  return `tree:${slug}`;
}

/**
 * Parse JSX file(s) into a `RenderableDesign`. The result is suitable
 * to feed directly into `buildDomIdMap` / `assignStableDomIds`.
 */
export function parseJsxToRenderableDesign(input: ParseJsxInput): RenderableDesign {
  if (!input || typeof input !== 'object') {
    throw new AtlasMapperError('jsx_parse_error', 'input must be an object', {});
  }
  if (typeof input.designVersionId !== 'string' || input.designVersionId.length === 0) {
    throw new AtlasMapperError(
      'jsx_parse_error',
      'designVersionId must be a non-empty string',
      {},
    );
  }
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new AtlasMapperError('jsx_parse_error', 'files[] must be non-empty', {});
  }

  // One ts-morph Project per parse call; we never persist it to disk
  // so a fresh in-memory project per call keeps state isolated.
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2 /* React */, allowJs: true, target: 99 },
  });

  const componentTrees: Record<string, RenderableComponentTree> = {};
  const routes: RenderableRoute[] = [];
  const copy: RenderableCopy[] = [];
  const copyByTempKey = new Map<string, RenderableCopy>();

  for (const file of input.files) {
    if (!file || typeof file.source !== 'string') {
      throw new AtlasMapperError('jsx_parse_error', 'each file must carry a source string', {
        file: file?.filePath,
      });
    }
    const sf = project.createSourceFile(file.filePath, file.source, {
      scriptKind: ScriptKind.JSX,
      overwrite: true,
    });

    const rootJsx = findRootJsx(sf);
    if (!rootJsx) {
      throw new AtlasMapperError(
        'jsx_parse_error',
        `no JSX root element found in '${file.filePath}'`,
        { filePath: file.filePath },
      );
    }

    const treeId = file.componentTreeId ?? defaultTreeId(file.routePath);
    const rootDomIdPrefix = treeId.replace(/^tree:/, 'root:');
    const copyAccumulator: Array<{ tempKey: string; text: string }> = [];
    const counter = { n: 0 };

    // Wrap a fragment root into a synthetic page-level div so it has
    // a single root tag — the rest of the pipeline expects one node.
    let rootNode: RenderableNode | null = null;
    if (rootJsx.isKind(SyntaxKind.JsxFragment)) {
      const wrapped: RenderableNode = {
        tag: 'fragment',
        role: 'page',
        children: [],
      };
      for (const c of rootJsx.getJsxChildren()) {
        if (c.isKind(SyntaxKind.JsxElement) || c.isKind(SyntaxKind.JsxSelfClosingElement)) {
          const child = jsxToNode(c, 1, copyAccumulator, treeId, counter);
          if (child) wrapped.children!.push(child);
        }
      }
      rootNode = wrapped;
    } else {
      rootNode = jsxToNode(rootJsx, 0, copyAccumulator, treeId, counter);
    }
    if (!rootNode) {
      throw new AtlasMapperError(
        'jsx_parse_error',
        `could not produce a root node from '${file.filePath}'`,
        { filePath: file.filePath },
      );
    }
    // Pin the tree root's domId from the route slug. Without this every
    // page in the fixture would derive the same root `div:page:0` and
    // the global uniqueness check would reject. The derived children
    // still get the route-prefixed parent path so survival semantics
    // hold across re-uploads.
    rootNode.domId = rootDomIdPrefix;

    for (const { tempKey, text } of copyAccumulator) {
      const entry: RenderableCopy = { domId: tempKey, text };
      copy.push(entry);
      copyByTempKey.set(tempKey, entry);
    }

    componentTrees[treeId] = { node: rootNode };
    const route: RenderableRoute = { path: file.routePath, componentTreeId: treeId };
    if (file.routeTitle !== undefined) route.title = file.routeTitle;
    routes.push(route);
  }

  return {
    designVersionId: input.designVersionId,
    source: input.source ?? 'jsx',
    routes,
    componentTrees,
    copy,
  };
}
