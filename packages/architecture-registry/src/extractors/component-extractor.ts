/**
 * @chiefaia/architecture-registry — ts-morph component extractor (ARCH-002)
 *
 * Walks the TypeScript AST of one or more `.tsx` / `.ts` files and emits
 * `arch_artifacts` rows for every React component plus dependency edges
 * for the libraries / hooks / sibling components they import.
 *
 * Component detection rules:
 *   - File must export a function/class whose return type is recognized
 *     as JSX (best-effort: name starts with capital + returns JSX, or
 *     `React.FC` / `React.FunctionComponent` typed).
 *   - Default export OR named export both count.
 *   - Component name = export name (or function/class name if anonymous
 *     default export).
 *
 * Prop interface extraction:
 *   - Inspects the first parameter type annotation; resolves type aliases
 *     and interfaces; captures `name`, `type`, `required`, `default`.
 *
 * The extractor is a pure transformation: source files in → ExtractionResult
 * out. No SQLite, no Ollama, no filesystem writes. Keeps it fast + unit
 * testable.
 */

import { nanoid } from 'nanoid';
import {
  Project,
  ScriptKind,
  SyntaxKind,
  type SourceFile,
  type Node,
  type FunctionDeclaration,
  type VariableDeclaration,
  type ClassDeclaration,
  type ParameterDeclaration,
  type Type,
} from 'ts-morph';
import {
  ArchArtifactRowSchema,
  ArchEdgeRowSchema,
  ComponentMetadataSchema,
  type ArchArtifactRow,
  type ArchEdgeRow,
  type ComponentMetadata,
  DEFAULT_EMBEDDING_DIM,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_VERSION,
} from '../schema';
import { computeArtifactDedupKey, computeEdgeDedupKey } from '../dedup-key';
import type { ExtractionResult, ExtractorOptions } from './ts-morph-types';
import { sha256 } from './utils';

// ─── Heuristics ──────────────────────────────────────────────────────────────

/** Component-name pattern: PascalCase, ≥2 chars. */
const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;

const REACT_TYPE_PREFIXES = [
  'React.FC',
  'React.FunctionComponent',
  'React.VoidFunctionComponent',
  'FC<',
  'FunctionComponent<',
  'VoidFunctionComponent<',
  'JSX.Element',
  'ReactElement',
  'ReactNode',
];

function isLikelyJsxReturn(returnType: string): boolean {
  return REACT_TYPE_PREFIXES.some((p) => returnType.includes(p));
}

/** Returns true when a function body actually returns JSX (regex fallback for inferred types). */
function bodyContainsJsx(body: Node | undefined): boolean {
  if (!body) return false;
  return (
    body.getDescendantsOfKind(SyntaxKind.JsxElement).length > 0 ||
    body.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement).length > 0 ||
    body.getDescendantsOfKind(SyntaxKind.JsxFragment).length > 0
  );
}

// ─── Per-prop parsing ────────────────────────────────────────────────────────

interface PropEntry {
  name: string;
  type: string;
  required: boolean;
  defaultValue?: string;
  description?: string;
}

function extractPropsFromParam(param: ParameterDeclaration | undefined): PropEntry[] {
  if (!param) return [];
  const typeNode = param.getTypeNode();
  if (!typeNode) {
    // Try to use the param's resolved type (Type) instead.
    return extractPropsFromType(param.getType());
  }
  // Inline literal type: `(props: { foo: string; bar?: number })`
  if (typeNode.getKind() === SyntaxKind.TypeLiteral) {
    const propsList: PropEntry[] = [];
    typeNode.forEachChild((c) => {
      if (c.getKind() === SyntaxKind.PropertySignature) {
        const sig = c.asKindOrThrow(SyntaxKind.PropertySignature);
        propsList.push({
          name: sig.getName(),
          type: sig.getTypeNode()?.getText() ?? 'unknown',
          required: !sig.hasQuestionToken(),
        });
      }
    });
    return propsList;
  }
  // Reference type: `(props: ButtonProps)` — resolve via Type and walk.
  return extractPropsFromType(param.getType());
}

function extractPropsFromType(type: Type): PropEntry[] {
  try {
    return type.getProperties().map((p) => {
      const decl = p.getDeclarations()[0];
      const propType = decl ? p.getTypeAtLocation(decl).getText(decl) : 'unknown';
      const optional = p.isOptional();
      return {
        name: p.getName(),
        type: propType,
        required: !optional,
      };
    });
  } catch {
    return [];
  }
}

// ─── Hooks + library scan ────────────────────────────────────────────────────

const REACT_HOOK_RE = /\buse[A-Z][A-Za-z0-9]*/g;

function collectHooksUsed(body: Node | undefined): string[] {
  if (!body) return [];
  const text = body.getText();
  const matches = text.match(REACT_HOOK_RE) ?? [];
  return Array.from(new Set(matches));
}

function collectImportedLibraries(sf: SourceFile): string[] {
  const libs = new Set<string>();
  for (const imp of sf.getImportDeclarations()) {
    const ms = imp.getModuleSpecifierValue();
    if (ms.startsWith('.') || ms.startsWith('/')) continue; // local
    libs.add(ms);
  }
  return Array.from(libs);
}

// ─── Per-file extraction ─────────────────────────────────────────────────────

interface ComponentCandidate {
  name: string;
  isDefaultExport: boolean;
  componentForm: 'function' | 'class' | 'arrow' | 'memo' | 'forwardRef';
  paramNode?: ParameterDeclaration;
  body?: Node;
  jsDocSummary?: string;
  signatureText: string;
}

function getJsDocSummary(node: Node): string | undefined {
  const docs = (node as unknown as { getJsDocs?: () => Array<{ getDescription(): string }> }).getJsDocs?.() ?? [];
  for (const d of docs) {
    const desc = d.getDescription().trim();
    if (desc.length > 0) return desc.split('\n')[0]!.trim();
  }
  return undefined;
}

function inspectFunctionDeclaration(fn: FunctionDeclaration): ComponentCandidate | undefined {
  const name = fn.getName();
  if (!name) return undefined;
  if (!COMPONENT_NAME_RE.test(name)) return undefined;
  const ret = fn.getReturnTypeNode()?.getText() ?? fn.getReturnType().getText();
  if (!isLikelyJsxReturn(ret) && !bodyContainsJsx(fn.getBody())) return undefined;
  return {
    name,
    isDefaultExport: fn.isDefaultExport(),
    componentForm: 'function',
    paramNode: fn.getParameters()[0],
    body: fn.getBody(),
    jsDocSummary: getJsDocSummary(fn),
    signatureText: fn.getText().split('\n').slice(0, 4).join('\n'),
  };
}

function inspectVariableDeclaration(v: VariableDeclaration): ComponentCandidate | undefined {
  const name = v.getName();
  if (!COMPONENT_NAME_RE.test(name)) return undefined;
  const init = v.getInitializer();
  if (!init) return undefined;
  // Cover three cases: arrow function, React.memo(...), React.forwardRef(...)
  const initText = init.getText();
  let componentForm: ComponentCandidate['componentForm'] = 'arrow';
  let inner: Node = init;
  if (initText.startsWith('React.memo(') || initText.startsWith('memo(')) {
    componentForm = 'memo';
    const args = init.asKind(SyntaxKind.CallExpression)?.getArguments() ?? [];
    if (args[0]) inner = args[0];
  } else if (initText.startsWith('React.forwardRef(') || initText.startsWith('forwardRef(')) {
    componentForm = 'forwardRef';
    const args = init.asKind(SyntaxKind.CallExpression)?.getArguments() ?? [];
    if (args[0]) inner = args[0];
  }
  // Now inner should be an arrow/function expression.
  const arrow = inner.asKind(SyntaxKind.ArrowFunction) ?? inner.asKind(SyntaxKind.FunctionExpression);
  if (!arrow) return undefined;
  const ret = arrow.getReturnTypeNode()?.getText() ?? arrow.getReturnType().getText();
  if (!isLikelyJsxReturn(ret) && !bodyContainsJsx(arrow.getBody())) return undefined;
  const stmt = v.getVariableStatement();
  return {
    name,
    isDefaultExport: stmt?.isDefaultExport() ?? false,
    componentForm,
    paramNode: arrow.getParameters()[0],
    body: arrow.getBody(),
    jsDocSummary: getJsDocSummary(stmt ?? v),
    signatureText: v.getText().split('\n').slice(0, 4).join('\n'),
  };
}

function inspectClassDeclaration(cl: ClassDeclaration): ComponentCandidate | undefined {
  const name = cl.getName();
  if (!name) return undefined;
  if (!COMPONENT_NAME_RE.test(name)) return undefined;
  const heritage = cl.getExtends();
  if (!heritage) return undefined;
  const ext = heritage.getText();
  if (!ext.includes('Component') && !ext.includes('PureComponent')) return undefined;
  const renderFn = cl.getMethod('render');
  if (!renderFn) return undefined;
  return {
    name,
    isDefaultExport: cl.isDefaultExport(),
    componentForm: 'class',
    paramNode: cl.getConstructors()[0]?.getParameters()[0], // props arg of constructor
    body: renderFn.getBody(),
    jsDocSummary: getJsDocSummary(cl),
    signatureText: `class ${name} extends ${ext}`,
  };
}

// ─── Public extractor ────────────────────────────────────────────────────────

/**
 * Extract React component artifacts from one or more source files.
 *
 * Caller passes a ts-morph `Project` (or we create one). Returns
 * `arch_artifacts` rows + dependency edges for libraries imported.
 */
export function extractComponentsFromProject(
  project: Project,
  sourceFiles: SourceFile[],
  opts: ExtractorOptions,
): ExtractionResult {
  const result: ExtractionResult = { artifacts: [], edges: [], warnings: [] };
  const newId = opts.newId ?? ((p) => `${p}_${nanoid(12)}`);

  for (const sf of sourceFiles) {
    const filePath = relativize(opts.repoRoot, sf.getFilePath());
    const fileText = sf.getFullText();
    const contentHash = sha256(fileText);

    const candidates: ComponentCandidate[] = [];
    for (const fn of sf.getFunctions()) {
      const c = inspectFunctionDeclaration(fn);
      if (c) candidates.push(c);
    }
    for (const v of sf.getVariableDeclarations()) {
      const c = inspectVariableDeclaration(v);
      if (c) candidates.push(c);
    }
    for (const cl of sf.getClasses()) {
      const c = inspectClassDeclaration(cl);
      if (c) candidates.push(c);
    }

    if (candidates.length === 0) continue;

    const importedLibraries = collectImportedLibraries(sf);

    for (const cand of candidates) {
      try {
        const props = extractPropsFromParam(cand.paramNode).map((p) => ({
          name: p.name,
          type: p.type,
          required: p.required,
          ...(p.defaultValue ? { defaultValue: p.defaultValue } : {}),
          ...(p.description ? { description: p.description } : {}),
        }));
        const hooksUsed = collectHooksUsed(cand.body);

        const componentMeta: ComponentMetadata = ComponentMetadataSchema.parse({
          props,
          exports: [cand.name],
          jsDocSummary: cand.jsDocSummary,
          isDefaultExport: cand.isDefaultExport,
          componentForm: cand.componentForm,
          hooksUsed,
          importedLibraries,
        });

        const techSubDomains = inferTechSubDomainsForComponent(filePath);
        const description = cand.jsDocSummary ?? synthesizeDescription(cand.name, props, importedLibraries);
        const id = newId('arch');
        const dedupKey = computeArtifactDedupKey({
          project: opts.defaultProject,
          kind: 'component',
          name: cand.name,
          entryPath: filePath,
        });

        const artifact: ArchArtifactRow = ArchArtifactRowSchema.parse({
          id,
          kind: 'component',
          project: opts.defaultProject,
          name: cand.name,
          description,
          keySignature: cand.signatureText,
          filePaths: [filePath],
          entryPath: filePath,
          designSystemTier: inferDesignSystemTier(filePath, cand.name),
          techSubDomains,
          tags: [],
          metadataJson: JSON.stringify(componentMeta),
          source: 'ast_extract',
          contentHash,
          extractedAtCommit: opts.extractedAtCommit,
          embeddingModel: DEFAULT_EMBEDDING_MODEL,
          embeddingDim: DEFAULT_EMBEDDING_DIM,
          embeddingVersion: DEFAULT_EMBEDDING_VERSION,
          createdAt: opts.now,
          updatedAt: opts.now,
          dedupKey,
        });

        result.artifacts.push(artifact);

        // Edges: depends_on each imported library (we'll only emit the
        // edge if the target package is also extracted by ARCH-003; for
        // ARCH-002 we emit a placeholder edge keyed on the package name
        // so callers can resolve it later).
        for (const lib of importedLibraries) {
          // Stable virtual id for placeholder package targets — safe to
          // upsert idempotently. ARCH-003 (package scan) will later emit
          // canonical artifacts with these same dedup keys; storage layer
          // resolves by dedup key.
          const placeholderTargetId = `pkg::${lib}`;
          const edgeId = newId('edge');
          const edge: ArchEdgeRow = ArchEdgeRowSchema.parse({
            id: edgeId,
            fromId: id,
            toId: placeholderTargetId,
            relation: 'depends_on',
            weight: 1.0,
            metadataJson: JSON.stringify({ kind: 'import' }),
            source: 'ast_extract',
            createdAt: opts.now,
            updatedAt: opts.now,
          });
          // Stash dedupKey + targetPackageName into metadata for caller
          // resolution.
          edge.metadataJson = JSON.stringify({
            kind: 'import',
            targetPackageName: lib,
            edgeDedupKey: computeEdgeDedupKey({
              fromId: id,
              toId: placeholderTargetId,
              relation: 'depends_on',
            }),
          });
          result.edges.push(edge);
        }
      } catch (err) {
        result.warnings.push(
          `component-extractor: ${filePath}#${cand.name} → ${(err as Error).message}`,
        );
      }
    }
  }

  return result;
}

/**
 * Convenience wrapper: build a ts-morph Project for a list of file paths
 * and extract.
 */
export function extractComponentsFromFiles(
  filePaths: string[],
  opts: ExtractorOptions,
): ExtractionResult {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    useInMemoryFileSystem: false,
    compilerOptions: {
      jsx: 4 /* React */ as unknown as never, // Preserve = 1 ; React = 2 ; ReactJSX = 4
      strict: false,
      allowJs: true,
      target: 99, // ESNext
    },
  });
  const sourceFiles: SourceFile[] = [];
  for (const fp of filePaths) {
    sourceFiles.push(project.addSourceFileAtPath(fp));
  }
  return extractComponentsFromProject(project, sourceFiles, opts);
}

/**
 * In-memory variant for unit tests.
 */
export function extractComponentsFromInMemorySources(
  sources: Array<{ path: string; content: string }>,
  opts: ExtractorOptions,
): ExtractionResult {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      jsx: 4 /* React */ as unknown as never,
      strict: false,
      allowJs: true,
      target: 99,
    },
  });
  const sourceFiles: SourceFile[] = sources.map((s) => {
    const isTsx = s.path.endsWith('.tsx');
    return project.createSourceFile(s.path, s.content, {
      scriptKind: isTsx ? ScriptKind.TSX : ScriptKind.TS,
    });
  });
  return extractComponentsFromProject(project, sourceFiles, opts);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function relativize(repoRoot: string, abs: string): string {
  if (abs.startsWith(repoRoot)) {
    let rel = abs.slice(repoRoot.length);
    if (rel.startsWith('/')) rel = rel.slice(1);
    return rel;
  }
  return abs;
}

function inferTechSubDomainsForComponent(filePath: string): string[] {
  const lower = filePath.toLowerCase();
  const tags = new Set<string>(['frontend']);
  if (lower.includes('design-system') || lower.includes('ui-primitives') || lower.includes('packages/ui')) {
    tags.add('design-system');
  }
  if (lower.includes('a11y') || lower.includes('accessibility')) {
    tags.add('accessibility');
  }
  if (lower.includes('analytics')) {
    tags.add('web-analytics');
  }
  return Array.from(tags);
}

function inferDesignSystemTier(filePath: string, name: string): 'primitive' | 'pattern' | 'feature' | 'page' | undefined {
  const lower = filePath.toLowerCase();
  if (lower.includes('/pages/') || lower.endsWith('/page.tsx') || lower.endsWith('/layout.tsx')) {
    return 'page';
  }
  // Design-system tiers: be permissive about the path between 'ui' / 'design-system' and 'primitive' / 'pattern'.
  if (/(?:design-system|ui|ui-primitives)\/[^/]*\/?primitive/i.test(filePath) || /\/primitive\//i.test(filePath)) {
    return 'primitive';
  }
  if (/(?:design-system|ui|ui-primitives)\/[^/]*\/?pattern/i.test(filePath) || /\/pattern\//i.test(filePath)) {
    return 'pattern';
  }
  if (lower.includes('feature') || /Page$/.test(name)) {
    return 'feature';
  }
  return undefined;
}

function synthesizeDescription(name: string, props: PropEntry[], libs: string[]): string {
  const propSummary = props.length === 0 ? 'no props' : `props: ${props.map((p) => p.name).join(', ')}`;
  const libSummary = libs.length === 0 ? '' : `; imports: ${libs.slice(0, 5).join(', ')}`;
  return `React component ${name} (${propSummary}${libSummary})`;
}
