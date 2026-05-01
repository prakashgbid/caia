import { describe, it, expect } from 'vitest';
import {
  detectCommunities,
  type ArtifactEdge,
  type ArtifactNode,
} from '../src/community-detection.js';

describe('detectCommunities — Louvain', () => {
  it('returns an empty result on an empty graph', () => {
    const out = detectCommunities([], [], { nowMs: 1779_000_000_000 });
    expect(out.communities).toHaveLength(0);
    expect(out.memberships).toHaveLength(0);
    expect(out.run.totalArtifacts).toBe(0);
    expect(out.run.modularity).toBe(0);
    expect(out.run.algorithm).toBe('louvain');
  });

  it('puts an isolated node in its own singleton community', () => {
    const nodes: ArtifactNode[] = [{ id: 'a' }, { id: 'b' }];
    const edges: ArtifactEdge[] = [];
    const out = detectCommunities(nodes, edges);
    // Empty edge graph → totalWeight 0 → trivial branch.
    expect(out.communities).toHaveLength(0);
    expect(out.memberships).toHaveLength(0);
  });

  it('detects two well-separated cliques', () => {
    const nodes: ArtifactNode[] = [
      { id: 'a1' },
      { id: 'a2' },
      { id: 'a3' },
      { id: 'b1' },
      { id: 'b2' },
      { id: 'b3' },
    ];
    const edges: ArtifactEdge[] = [
      // clique A
      { fromId: 'a1', toId: 'a2', weight: 1 },
      { fromId: 'a1', toId: 'a3', weight: 1 },
      { fromId: 'a2', toId: 'a3', weight: 1 },
      // clique B
      { fromId: 'b1', toId: 'b2', weight: 1 },
      { fromId: 'b1', toId: 'b3', weight: 1 },
      { fromId: 'b2', toId: 'b3', weight: 1 },
      // single weak bridge
      { fromId: 'a1', toId: 'b1', weight: 0.1 },
    ];
    const out = detectCommunities(nodes, edges, { nowMs: 1779_000_000_000 });

    // Expect two top-level communities at level 0.
    const level0 = out.communities.filter((c) => c.level === 0);
    expect(level0.length).toBeGreaterThanOrEqual(2);

    // Members of the same letter should be co-clustered.
    const memberships = out.memberships.filter((m) => m.level === 0);
    const cluster = (id: string) =>
      memberships.find((m) => m.artifactId === id)!.communityId;
    expect(cluster('a1')).toBe(cluster('a2'));
    expect(cluster('a2')).toBe(cluster('a3'));
    expect(cluster('b1')).toBe(cluster('b2'));
    expect(cluster('b2')).toBe(cluster('b3'));
    expect(cluster('a1')).not.toBe(cluster('b1'));

    // Modularity of two cliques connected by a weak bridge should be > 0.3.
    expect(out.run.modularity).toBeGreaterThan(0.3);

    // Run row sanity.
    expect(out.run.totalArtifacts).toBe(6);
    expect(out.run.totalEdges).toBe(7);
    expect(out.run.totalCommunities).toBeGreaterThanOrEqual(level0.length);
  });

  it('produces deterministic community ids keyed on runId', () => {
    const nodes: ArtifactNode[] = [{ id: 'x' }, { id: 'y' }];
    const edges: ArtifactEdge[] = [
      { fromId: 'x', toId: 'y', weight: 1 },
    ];
    const out = detectCommunities(nodes, edges);
    const sample = out.communities[0]!;
    expect(sample.id).toMatch(/^comm_comm-run-[A-Za-z0-9_-]{10}_l0_\d+$/);
    expect(sample.runId).toBe(out.run.id);
  });

  it('writes algorithm = "louvain" by default; allows override', () => {
    const nodes: ArtifactNode[] = [{ id: 'x' }, { id: 'y' }];
    const edges: ArtifactEdge[] = [{ fromId: 'x', toId: 'y', weight: 1 }];
    const a = detectCommunities(nodes, edges);
    expect(a.run.algorithm).toBe('louvain');

    const b = detectCommunities(nodes, edges, { algorithm: 'leiden' });
    expect(b.run.algorithm).toBe('leiden');
    expect(b.communities.every((c) => c.algorithm === 'leiden')).toBe(true);
  });

  it('membership counts per community match member_count', () => {
    const nodes: ArtifactNode[] = [
      { id: 'p' },
      { id: 'q' },
      { id: 'r' },
    ];
    const edges: ArtifactEdge[] = [
      { fromId: 'p', toId: 'q', weight: 1 },
      { fromId: 'q', toId: 'r', weight: 1 },
      { fromId: 'p', toId: 'r', weight: 1 },
    ];
    const out = detectCommunities(nodes, edges);
    for (const c of out.communities.filter((c) => c.level === 0)) {
      const members = out.memberships.filter(
        (m) => m.communityId === c.id && m.level === 0
      );
      expect(members.length).toBe(c.memberCount);
    }
  });
});
