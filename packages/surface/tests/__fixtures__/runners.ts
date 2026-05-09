/**
 * Fake GhRunner / GitRunner for tests.
 */

import type { GhRunner, GitRunner } from '../../src/types.js';

export class FakeGh implements GhRunner {
  private readonly responses: Array<{ match: (args: readonly string[]) => boolean; result: string | Error }> = [];

  on(match: (args: readonly string[]) => boolean, result: string | Error): this {
    this.responses.push({ match, result });
    return this;
  }

  async run(args: readonly string[]): Promise<string> {
    for (const r of this.responses) {
      if (r.match(args)) {
        if (r.result instanceof Error) throw r.result;
        return r.result;
      }
    }
    throw new Error(`fake-gh: no matching response for: ${args.join(' ')}`);
  }
}

export class FakeGit implements GitRunner {
  private readonly responses: Array<{ repo: string; match: (args: readonly string[]) => boolean; result: string | Error }> = [];

  on(repo: string, match: (args: readonly string[]) => boolean, result: string | Error): this {
    this.responses.push({ repo, match, result });
    return this;
  }

  async log(repo: string, args: readonly string[]): Promise<string> {
    for (const r of this.responses) {
      if (r.repo === repo && r.match(args)) {
        if (r.result instanceof Error) throw r.result;
        return r.result;
      }
    }
    throw new Error(`fake-git: no matching response for ${repo}: ${args.join(' ')}`);
  }
}
