/**
 * Loader for the canonical eval suite.
 */

import * as yaml from 'js-yaml';

import type { FsReader } from './types.js';

export interface CanonicalSuiteAssertion {
  readonly type: string;
  readonly value?: unknown;
  readonly weight?: number;
}

export interface CanonicalSuiteTest {
  readonly description: string;
  readonly vars?: Readonly<Record<string, unknown>>;
  readonly assert?: ReadonlyArray<CanonicalSuiteAssertion>;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CanonicalSuiteDefaultTest {
  readonly assert?: ReadonlyArray<CanonicalSuiteAssertion>;
}

export interface CanonicalSuite {
  readonly description: string;
  readonly version: number;
  readonly maintainer?: string;
  readonly defaultTest?: CanonicalSuiteDefaultTest;
  readonly tests: ReadonlyArray<CanonicalSuiteTest>;
}

export class SuiteLoadError extends Error {
  public readonly path: string;
  constructor(path: string, message: string) {
    super(`[aiml-architect] failed to load canonical suite ${path}: ${message}`);
    this.name = 'SuiteLoadError';
    this.path = path;
  }
}

export function loadCanonicalSuite(
  path: string,
  fs: FsReader
): CanonicalSuite {
  if (!fs.exists(path)) {
    throw new SuiteLoadError(path, 'file not found');
  }
  const raw = fs.readFile(path);
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (e) {
    throw new SuiteLoadError(path, String(e));
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new SuiteLoadError(path, 'YAML did not parse to an object');
  }
  const obj = parsed as Record<string, unknown>;
  const description = typeof obj.description === 'string' ? obj.description : '';
  const version = typeof obj.version === 'number' ? obj.version : 1;
  const tests = Array.isArray(obj.tests) ? (obj.tests as CanonicalSuiteTest[]) : [];

  const base: { description: string; version: number; tests: ReadonlyArray<CanonicalSuiteTest> } = {
    description,
    version,
    tests
  };
  const withMaintainer =
    typeof obj.maintainer === 'string'
      ? { ...base, maintainer: obj.maintainer }
      : base;
  const withDefault =
    obj.defaultTest && typeof obj.defaultTest === 'object'
      ? { ...withMaintainer, defaultTest: obj.defaultTest as CanonicalSuiteDefaultTest }
      : withMaintainer;
  return withDefault as CanonicalSuite;
}
