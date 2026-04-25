import type { DecompositionTree } from './types';

export class ConductorClient {
  constructor(private baseUrl: string = 'http://localhost:7776') {}

  async persistTree(tree: DecompositionTree): Promise<{ persisted: number; rootId: string }> {
    let persisted = 0;
    // BFS order ensures parents exist before children
    for (const id of tree.orderedIds) {
      const node = tree.nodes.get(id)!;
      try {
        await fetch(`${this.baseUrl}/stories`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: node.id,
            parent_id: node.parentId,
            prev_sibling_id: node.prevSiblingId,
            next_sibling_id: node.nextSiblingId,
            ordinal: node.ordinal,
            kind: node.kind,
            title: node.title,
            description: node.description,
            expected_behavior: node.expectedBehavior,
            acceptance_criteria: node.acceptanceCriteria,
            verification_plan: node.verificationPlan,
            behavior_test_path: node.behaviorTestPath,
            depends_on: node.dependsOn,
            project_slug: node.projectSlug,
            domain_slugs: node.domainSlugs,
          }),
        });
        persisted++;
      } catch {
        // Non-fatal: continue persisting siblings
      }
    }
    return { persisted, rootId: tree.rootId };
  }

  async getStory(id: string, includeTree = false): Promise<unknown> {
    const url = includeTree ? `${this.baseUrl}/stories/${id}/tree` : `${this.baseUrl}/stories/${id}`;
    const res = await fetch(url);
    return res.json();
  }

  async listStories(params: Record<string, string> = {}): Promise<unknown[]> {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.baseUrl}/stories${qs ? '?' + qs : ''}`);
    return res.json() as Promise<unknown[]>;
  }
}
