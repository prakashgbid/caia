/**
 * Research log — append-only markdown at
 * caia-ea/research-log/<topic-slug>.md
 *
 * Each entry tracks dispatch metadata + status + (eventually) the link
 * to the produced research markdown.
 */

import { join } from 'node:path';

import { defaultFsAdapter, type FsAdapter } from '@caia/ea-architect';

import type { ResearchRequest } from './types.js';

export class ResearchLog {
  constructor(
    private readonly repoRoot: string,
    private readonly fs: FsAdapter = defaultFsAdapter
  ) {}

  pathFor(topicSlug: string): string {
    return join(this.repoRoot, 'research-log', `${topicSlug}.md`);
  }

  appendDispatch(topicSlug: string, request: ResearchRequest, ts: Date): string {
    const path = this.pathFor(topicSlug);
    const line = `\n## Dispatched at ${ts.toISOString()}\n\n- Topic: ${request.topic}\n- Requester: ${request.requesterAgentId}\n- Priority: ${request.priority ?? 'medium'}\n- Status: in-flight\n\n${request.brief}\n`;
    if (this.fs.exists(path)) {
      this.fs.appendFile(path, line);
    } else {
      const header = `# Research log — ${topicSlug}\n\nMaintained by @caia/ea-research-conductor. One entry per dispatch.\n`;
      this.fs.writeFile(path, header + line);
    }
    return path;
  }

  appendCompletion(topicSlug: string, resultPath: string, ts: Date): void {
    const path = this.pathFor(topicSlug);
    const line = `\n## Completed at ${ts.toISOString()}\n\n- Result: ${resultPath}\n- Status: done\n`;
    if (this.fs.exists(path)) {
      this.fs.appendFile(path, line);
    }
  }
}

export function slugify(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}
