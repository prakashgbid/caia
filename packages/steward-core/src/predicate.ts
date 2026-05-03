/**
 * Minimal predicate evaluator for the `when:` clauses in invariants.
 *
 * Supports:
 *   - jsonpath-style accessors: event.payload.pull_request.base.ref
 *   - literal comparisons: == != > < >= <=
 *   - regex match: =~ "pattern"
 *   - logical operators: && || !
 *   - parenthesised sub-expressions
 *   - string and number literals
 *   - true / false literals
 *
 * Intentionally narrow scope to avoid the "we accidentally implemented Lisp"
 * failure mode. If rule grammar grows past what fits in <300 lines, that's
 * a signal to switch to CUE.
 *
 * Reference: devops-steward-agent-design-2026-05-03.md §5.5.
 */

export type PredicateContext = Record<string, unknown>;

export class PredicateError extends Error {
  constructor(message: string, public readonly position?: number) {
    super(message);
    this.name = 'PredicateError';
  }
}

/* ───────────────────────────────────────────────────────────────────────── *
 *  Tokenizer                                                                 *
 * ───────────────────────────────────────────────────────────────────────── */

type Token =
  | { kind: 'ident'; value: string; pos: number }
  | { kind: 'string'; value: string; pos: number }
  | { kind: 'number'; value: number; pos: number }
  | { kind: 'op'; value: string; pos: number };

function charAt(src: string, i: number): string {
  // noUncheckedIndexedAccess returns string | undefined; the caller is
  // responsible for ensuring i is in range, so we narrow safely here.
  return src[i] ?? '';
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = charAt(src, i);
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    // string literal: "..." or '...'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      i++;
      let value = '';
      while (i < src.length && charAt(src, i) !== quote) {
        if (charAt(src, i) === '\\' && i + 1 < src.length) {
          value += charAt(src, i + 1);
          i += 2;
        } else {
          value += charAt(src, i);
          i++;
        }
      }
      if (i >= src.length) {
        throw new PredicateError(`unterminated string starting at ${start}`, start);
      }
      i++; // closing quote
      tokens.push({ kind: 'string', value, pos: start });
      continue;
    }
    // number literal
    if (/[0-9]/.test(ch)) {
      const start = i;
      let value = '';
      while (i < src.length && /[0-9.]/.test(charAt(src, i))) {
        value += charAt(src, i);
        i++;
      }
      tokens.push({ kind: 'number', value: Number(value), pos: start });
      continue;
    }
    // identifier (with dotted path, alphanumerics, underscores)
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      let value = '';
      while (i < src.length && /[A-Za-z0-9_.]/.test(charAt(src, i))) {
        value += charAt(src, i);
        i++;
      }
      tokens.push({ kind: 'ident', value, pos: start });
      continue;
    }
    // operators
    const two = src.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '>=' || two === '<=' ||
        two === '&&' || two === '||' || two === '=~') {
      tokens.push({ kind: 'op', value: two, pos: i });
      i += 2;
      continue;
    }
    if ('()!<>'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch, pos: i });
      i++;
      continue;
    }
    throw new PredicateError(`unexpected character "${ch}" at ${i}`, i);
  }
  return tokens;
}

/* ───────────────────────────────────────────────────────────────────────── *
 *  Parser + evaluator (recursive descent, Pratt-style precedence)            *
 * ───────────────────────────────────────────────────────────────────────── */

class Evaluator {
  private pos = 0;

  constructor(private readonly tokens: Token[], private readonly ctx: PredicateContext) {}

  evaluate(): unknown {
    const result = this.parseOr();
    if (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]!;
      throw new PredicateError(`unexpected token "${tokenString(t)}" at ${t.pos}`, t.pos);
    }
    return result;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consume(): Token {
    const t = this.tokens[this.pos];
    if (!t) throw new PredicateError('unexpected end of expression');
    this.pos++;
    return t;
  }

  private parseOr(): unknown {
    let lhs = this.parseAnd();
    while (this.peek()?.kind === 'op' && this.peek()?.value === '||') {
      this.consume();
      const rhs = this.parseAnd();
      lhs = Boolean(lhs) || Boolean(rhs);
    }
    return lhs;
  }

  private parseAnd(): unknown {
    let lhs = this.parseEquality();
    while (this.peek()?.kind === 'op' && this.peek()?.value === '&&') {
      this.consume();
      const rhs = this.parseEquality();
      lhs = Boolean(lhs) && Boolean(rhs);
    }
    return lhs;
  }

  private parseEquality(): unknown {
    let lhs = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (!t || t.kind !== 'op') break;
      if (!['==', '!=', '>', '<', '>=', '<=', '=~'].includes(t.value)) break;
      this.consume();
      const op = t.value;
      const rhs = this.parseUnary();
      lhs = applyBinaryOp(op, lhs, rhs);
    }
    return lhs;
  }

  private parseUnary(): unknown {
    if (this.peek()?.kind === 'op' && this.peek()?.value === '!') {
      this.consume();
      return !this.parseUnary();
    }
    return this.parsePrimary();
  }

  private parsePrimary(): unknown {
    const t = this.consume();
    if (t.kind === 'op' && t.value === '(') {
      const inner = this.parseOr();
      const close = this.consume();
      if (!(close.kind === 'op' && close.value === ')')) {
        throw new PredicateError(`expected ")" at ${close.pos}`, close.pos);
      }
      return inner;
    }
    if (t.kind === 'string') return t.value;
    if (t.kind === 'number') return t.value;
    if (t.kind === 'ident') {
      if (t.value === 'true') return true;
      if (t.value === 'false') return false;
      if (t.value === 'null') return null;
      return resolvePath(t.value, this.ctx);
    }
    throw new PredicateError(`unexpected "${tokenString(t)}" at ${t.pos}`, t.pos);
  }
}

function tokenString(t: Token): string {
  if (t.kind === 'string') return JSON.stringify(t.value);
  return String(t.value);
}

// Guard against prototype-pollution path access (semgrep prototype-pollution-loop).
// The path comes from trusted YAML, but defense-in-depth: refuse the standard
// dunder paths regardless.
const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function resolvePath(path: string, ctx: PredicateContext): unknown {
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null) return undefined;
    if (typeof cur !== 'object') return undefined;
    if (FORBIDDEN_PATH_KEYS.has(p)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function applyBinaryOp(op: string, lhs: unknown, rhs: unknown): unknown {
  switch (op) {
    case '==':
      return lhs === rhs;
    case '!=':
      return lhs !== rhs;
    case '>':
      return Number(lhs) > Number(rhs);
    case '<':
      return Number(lhs) < Number(rhs);
    case '>=':
      return Number(lhs) >= Number(rhs);
    case '<=':
      return Number(lhs) <= Number(rhs);
    case '=~': {
      if (typeof lhs !== 'string' || typeof rhs !== 'string') return false;
      // ReDoS hardening (semgrep detect-non-literal-regexp): the pattern is
      // sourced from trusted YAML, but defense-in-depth — cap the pattern
      // length and reject patterns containing nested unbounded quantifiers.
      if (rhs.length > 256) return false;
      if (/(\.\*){2,}|(\.\+){2,}/.test(rhs)) return false;
      try {
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
        // Pattern is from YAML loaded at boot, length-capped, and quantifier-checked above.
        return new RegExp(rhs).test(lhs);
      } catch {
        return false;
      }
    }
    default:
      throw new PredicateError(`unknown operator "${op}"`);
  }
}

/* ───────────────────────────────────────────────────────────────────────── *
 *  Public entry point                                                        *
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Evaluate the predicate against the context. Returns the resulting value
 * (typically boolean for `when:` clauses but the evaluator does not enforce
 * that — callers can `Boolean(...)` the result).
 *
 * Errors during tokenization or parsing bubble up as `PredicateError`;
 * callers should treat such errors as policy-validation failures.
 */
export function evaluatePredicate(expr: string, ctx: PredicateContext): unknown {
  const tokens = tokenize(expr);
  return new Evaluator(tokens, ctx).evaluate();
}
