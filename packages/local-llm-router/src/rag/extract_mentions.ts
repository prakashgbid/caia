// extract_mentions.ts — pull file paths and code symbols from a user message.
//
// We try to be permissive on the path regex (Stolution prompts cite paths in
// markdown, backticks, prose, or git-style diffs) and strict on the symbol
// regex (camelCase / PascalCase / snake_case identifiers that look distinctive
// — too loose a match would flood the embed step with noise like "the").
//
// Output is deduplicated and order-preserving so the downstream embed step
// can use the first mention as the query if needed.

const FILE_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs',
  'py', 'pyi',
  'md', 'mdx',
  'yaml', 'yml', 'json', 'toml',
  'go', 'rs', 'java', 'kt', 'rb', 'php', 'cs',
  'sh', 'bash', 'zsh',
  'sql', 'graphql', 'css', 'scss', 'html',
];

// Match path-like tokens. Accepts:
//   packages/foo/src/bar.ts
//   ~/Documents/projects/caia/packages/foo/bar.py
//   ./relative/path/to/file.tsx
//   /absolute/path/to/file.md
//   src/foo.ts:42
// Excludes pure URLs (handled by the http/https guard below).
const PATH_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9])` +
  String.raw`((?:~\/|\.\/|\.\.\/|\/)?` +
  String.raw`(?:[A-Za-z0-9._-]+\/){1,}` +
  String.raw`[A-Za-z0-9._-]+\.(?:` + FILE_EXTENSIONS.join('|') + `))` +
  String.raw`(?::\d+)?`,
  'g'
);

// Match camelCase / PascalCase / snake_case identifiers >= 4 chars and with at
// least one transition (so plain words like "function" don't match).
const SYMBOL_RE = /\b([A-Z][a-z]+[A-Z][A-Za-z0-9]+|[a-z]+[A-Z][A-Za-z0-9]+|[a-z]+_[a-z][a-z0-9_]+)\b/g;

// Backtick-quoted spans get an extra pass: anything inside backticks that
// looks like a callable (foo(), Foo.bar, etc) is captured as a symbol even if
// it didn't survive the strict pattern above.
const BACKTICK_RE = /`([^`]{2,80})`/g;
const CALLABLE_RE = /\b([A-Za-z_][A-Za-z0-9_]*)(?:\(\)|\.\w+)/;

export interface ExtractedMentions {
  paths: string[];
  symbols: string[];
  // True if there is at least one path or at least one symbol — used by
  // middleware.ts to decide whether to bother embedding the query.
  hasMentions: boolean;
}

function uniq(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (!seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}

export function extractMentions(text: string): ExtractedMentions {
  const paths: string[] = [];
  const symbols: string[] = [];

  // First pass: paths from raw text (line-anchored line:col strips happen
  // in the regex via the optional `:\d+` group; we discard the line suffix).
  let m: RegExpExecArray | null;
  PATH_RE.lastIndex = 0;
  while ((m = PATH_RE.exec(text)) !== null) {
    const candidate = m[1];
    if (candidate === undefined) continue;
    // Skip if it looks like a URL host (the path-re won't capture "://" but
    // belt-and-braces: drop if previous chars are "://")
    const idx = m.index;
    if (idx >= 2 && text.slice(idx - 3, idx) === '://') continue;
    paths.push(candidate);
  }

  // Second pass: distinctive symbols from raw text.
  SYMBOL_RE.lastIndex = 0;
  while ((m = SYMBOL_RE.exec(text)) !== null) {
    if (m[1] !== undefined) symbols.push(m[1]);
  }

  // Third pass: backtick-quoted callables.
  BACKTICK_RE.lastIndex = 0;
  while ((m = BACKTICK_RE.exec(text)) !== null) {
    const inner = m[1];
    if (inner === undefined) continue;
    const cm = CALLABLE_RE.exec(inner);
    if (cm !== null && cm[1] !== undefined && cm[1].length >= 3) symbols.push(cm[1]);
  }

  const uPaths = uniq(paths);
  const uSyms = uniq(symbols);
  return {
    paths: uPaths,
    symbols: uSyms,
    hasMentions: uPaths.length > 0 || uSyms.length > 0,
  };
}

// Format the extracted mentions as a single short query string the embedding
// model can chew on. We prefer paths (they are the strongest signal); if none,
// fall back to symbols joined with spaces.
export function mentionsToQuery(m: ExtractedMentions, fullText: string): string {
  if (m.paths.length > 0) {
    // Paths plus a small slice of context so the embedding is not a bag of
    // filenames in isolation.
    const ctx = fullText.length > 400 ? fullText.slice(0, 400) : fullText;
    return [...m.paths, ctx].join(' ');
  }
  if (m.symbols.length > 0) {
    return m.symbols.slice(0, 8).join(' ');
  }
  return fullText.slice(0, 400);
}
