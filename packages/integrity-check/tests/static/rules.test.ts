import { describe, it, expect } from 'vitest';
import { parseFile } from '../../src/static/ast';
import { checkDeadOnClick } from '../../src/static/rules/dead-onclick';
import { checkButtonWithoutAction } from '../../src/static/rules/button-without-action';
import { checkMissingHref } from '../../src/static/rules/missing-href';
import { checkUnknownHandlers } from '../../src/static/rules/unknown-handler';

const FILE = '/fixture/Component.tsx';

function parse(code: string) {
  const ast = parseFile(code, FILE);
  if (!ast) throw new Error('parse failed');
  return ast;
}

// ── dead-onclick ─────────────────────────────────────────────────────────────

describe('dead-onclick', () => {
  it('flags empty arrow function', () => {
    const ast = parse(`export function A() { return <button onClick={() => {}} />; }`);
    const issues = checkDeadOnClick(ast, FILE);
    expect(issues).toHaveLength(1);
    expect(issues[0].rule).toBe('dead-onclick');
    expect(issues[0].severity).toBe('error');
  });

  it('flags noop identifier', () => {
    const ast = parse(`export function A() { return <button onClick={noop} />; }`);
    const issues = checkDeadOnClick(ast, FILE);
    expect(issues).toHaveLength(1);
    expect(issues[0].severity).toBe('warning');
  });

  it('does NOT flag real handler', () => {
    const ast = parse(`export function A() { const h = () => console.log('hi'); return <button onClick={h} />; }`);
    const issues = checkDeadOnClick(ast, FILE);
    expect(issues).toHaveLength(0);
  });

  it('does NOT flag inline with real body', () => {
    const ast = parse(`export function A() { return <button onClick={() => doSomething()} />; }`);
    const issues = checkDeadOnClick(ast, FILE);
    expect(issues).toHaveLength(0);
  });
});

// ── button-without-action ────────────────────────────────────────────────────

describe('button-without-action', () => {
  it('flags button with no onClick or type', () => {
    const ast = parse(`export function A() { return <button>Click me</button>; }`);
    const issues = checkButtonWithoutAction(ast, FILE);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].rule).toBe('button-without-action');
  });

  it('does NOT flag button with onClick', () => {
    const ast = parse(`export function A() { return <button onClick={fn}>Click</button>; }`);
    const issues = checkButtonWithoutAction(ast, FILE);
    expect(issues).toHaveLength(0);
  });

  it('does NOT flag button with type="submit"', () => {
    const ast = parse(`export function A() { return <button type="submit">Submit</button>; }`);
    const issues = checkButtonWithoutAction(ast, FILE);
    expect(issues).toHaveLength(0);
  });

  it('does NOT flag button inside form', () => {
    const ast = parse(`export function A() { return <form><button>Submit</button></form>; }`);
    const issues = checkButtonWithoutAction(ast, FILE);
    expect(issues).toHaveLength(0);
  });
});

// ── missing-href ─────────────────────────────────────────────────────────────

describe('missing-href', () => {
  it('flags empty href', () => {
    const ast = parse(`export function A() { return <a href="">Text</a>; }`);
    const issues = checkMissingHref(ast, FILE);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].rule).toBe('missing-href');
    expect(issues[0].severity).toBe('error');
  });

  it('flags href="#"', () => {
    const ast = parse(`export function A() { return <a href="#">Text</a>; }`);
    const issues = checkMissingHref(ast, FILE);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].severity).toBe('warning');
  });

  it('does NOT flag href="#" with aria-expanded (toggle pattern)', () => {
    const ast = parse(`export function A() { return <a href="#" aria-expanded="true">Toggle</a>; }`);
    const issues = checkMissingHref(ast, FILE);
    expect(issues).toHaveLength(0);
  });

  it('does NOT flag valid href', () => {
    const ast = parse(`export function A() { return <a href="/about">About</a>; }`);
    const issues = checkMissingHref(ast, FILE);
    expect(issues).toHaveLength(0);
  });

  it('flags Link with empty href', () => {
    const ast = parse(`import Link from 'next/link'; export function A() { return <Link href="">Home</Link>; }`);
    const issues = checkMissingHref(ast, FILE);
    expect(issues.length).toBeGreaterThan(0);
  });
});

// ── unknown-handler ──────────────────────────────────────────────────────────

describe('unknown-handler', () => {
  it('flags onClick referencing undeclared identifier', () => {
    const ast = parse(`export function A() { return <button onClick={handleMagic}>Click</button>; }`);
    const issues = checkUnknownHandlers(ast, FILE);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].rule).toBe('unknown-handler');
  });

  it('does NOT flag onClick referencing declared const', () => {
    const ast = parse(`
      export function A() {
        const handleClick = () => alert('hi');
        return <button onClick={handleClick}>Click</button>;
      }
    `);
    const issues = checkUnknownHandlers(ast, FILE);
    expect(issues).toHaveLength(0);
  });

  it('does NOT flag onClick referencing imported function', () => {
    const ast = parse(`
      import { handleSubmit } from './handlers';
      export function A() {
        return <button onClick={handleSubmit}>Submit</button>;
      }
    `);
    const issues = checkUnknownHandlers(ast, FILE);
    expect(issues).toHaveLength(0);
  });
});
