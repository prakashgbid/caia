'use client';
import { useState, Suspense } from 'react';
import useSWR from 'swr';
import { useSearchParams, useRouter } from 'next/navigation';
import { SpikeWorkflowCard, detectSpikePhases } from '../../../components/SpikeWorkflowCard';
import { VerbIntentBadge } from '../../../components/VerbIntentBadge';
import type { ChoreTask } from '../../../components/ChoreWorkflowCard';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const KIND_COLOR: Record<string, string> = {
  epic: '#9f7aea',
  story: '#63b3ed',
  sub_story: '#68d391',
  task: '#f6ad55',
  sub_task: '#fc8181',
  todo: '#a0aec0',
};

const STATUS_COLOR: Record<string, string> = {
  pending: '#a0aec0',
  verified: '#68d391',
  failed: '#fc8181',
  partial: '#f6ad55',
};

interface StoryNode {
  id: string;
  parentId: string | null;
  kind: string;
  title: string;
  description: string;
  expectedBehavior: string;
  acceptanceCriteriaJson: string;
  verificationPlanJson: string;
  status: string;
  projectSlug: string | null;
  ordinal: number;
  behaviorTestPath: string | null;
}

function parseJson(s: string, fallback: unknown = []) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function buildForest(nodes: StoryNode[]): StoryNode[] {
  return nodes.filter(n => !n.parentId).sort((a, b) => a.ordinal - b.ordinal);
}

function getChildren(nodes: StoryNode[], parentId: string): StoryNode[] {
  return nodes.filter(n => n.parentId === parentId).sort((a, b) => a.ordinal - b.ordinal);
}

function StoryNodeCard({ node, allNodes, depth, choreStoryIds }: { node: StoryNode; allNodes: StoryNode[]; depth: number; choreStoryIds: Set<string> }) {
  const [isExpanded, setIsExpanded] = useState(depth < 2);
  const [showDetail, setShowDetail] = useState(false);
  const children = getChildren(allNodes, node.id);
  const criteria = parseJson(node.acceptanceCriteriaJson) as string[];
  const plan = parseJson(node.verificationPlanJson) as string[];

  // Spike epic detection: if ≥2 children match spike phase title prefixes,
  // treat this node as a spike epic and show the workflow card.
  const spikePhases = detectSpikePhases(children);
  const isSpikeEpic = spikePhases.filter((p) => p.status !== 'absent').length >= 2;

  // Chore task detection: this story node is linked to a backend chore task
  // when the conductor has a ChoreTask whose storyId matches this node's id.
  const isChoreStory = choreStoryIds.has(node.id);

  return (
    <div style={{ marginLeft: depth * 16, marginBottom: 4 }}>
      <div
        style={{
          background: '#1a1f2e',
          border: `1px solid ${STATUS_COLOR[node.status] ?? '#2d3748'}`,
          borderLeft: `3px solid ${isSpikeEpic ? '#4fd1c5' : (KIND_COLOR[node.kind] ?? '#4a5568')}`,
          borderRadius: 6,
          padding: '8px 12px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 2,
        }}
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        aria-expanded={isExpanded}
      >
        {children.length > 0 && (
          <span style={{ color: '#718096', fontSize: 12, userSelect: 'none' }}>
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
        <span style={{ fontSize: 11, color: KIND_COLOR[node.kind] ?? '#a0aec0', fontWeight: 600, textTransform: 'uppercase', minWidth: 60 }}>
          {node.kind.replace('_', ' ')}
        </span>
        {isSpikeEpic && <VerbIntentBadge intent="spike" size="sm" />}
        {isChoreStory && <VerbIntentBadge intent="chore" size="sm" />}
        <span style={{ flex: 1, fontSize: 13, color: '#e2e8f0' }}>{node.title}</span>
        <span style={{
          fontSize: 10,
          padding: '2px 6px',
          borderRadius: 10,
          background: STATUS_COLOR[node.status] + '33',
          color: STATUS_COLOR[node.status],
          fontWeight: 600,
          textTransform: 'uppercase',
        }}>
          {node.status}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); setShowDetail(!showDetail); }}
          style={{ background: 'none', border: '1px solid #4a5568', borderRadius: 4, color: '#a0aec0', cursor: 'pointer', fontSize: 11, padding: '2px 6px' }}
          aria-label="Toggle details"
        >
          {showDetail ? 'hide' : 'detail'}
        </button>
      </div>

      {/* Spike workflow progress — always visible when expanded for spike epics */}
      {isSpikeEpic && isExpanded && (
        <div style={{ marginLeft: 16, marginBottom: 4 }}>
          <SpikeWorkflowCard phases={spikePhases} />
        </div>
      )}

      {showDetail && (
        <div style={{ marginLeft: 16, background: '#141820', border: '1px solid #2d3748', borderRadius: 6, padding: 12, marginBottom: 4, fontSize: 12 }}>
          {node.description && (
            <p style={{ color: '#a0aec0', margin: '0 0 8px' }}>{node.description}</p>
          )}
          {node.expectedBehavior && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#718096', fontWeight: 600, marginBottom: 4 }}>Expected behavior:</div>
              <div style={{ color: '#e2e8f0' }}>{node.expectedBehavior}</div>
            </div>
          )}
          {criteria.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ color: '#718096', fontWeight: 600, marginBottom: 4 }}>Acceptance criteria ({criteria.length}):</div>
              <ul style={{ margin: 0, paddingLeft: 16, color: '#cbd5e0' }}>
                {criteria.map((c, i) => <li key={i} style={{ marginBottom: 2 }}>{c}</li>)}
              </ul>
            </div>
          )}
          {plan.length > 0 && (
            <div>
              <div style={{ color: '#718096', fontWeight: 600, marginBottom: 4 }}>Verification plan:</div>
              <ul style={{ margin: 0, paddingLeft: 16, color: '#90cdf4' }}>
                {plan.map((p, i) => <li key={i} style={{ marginBottom: 2, fontFamily: 'monospace', fontSize: 11 }}>{p}</li>)}
              </ul>
            </div>
          )}
          {node.behaviorTestPath && (
            <div style={{ marginTop: 8, padding: '4px 8px', background: '#2d3748', borderRadius: 4, fontFamily: 'monospace', fontSize: 11, color: '#68d391' }}>
              📄 {node.behaviorTestPath}
            </div>
          )}
          {isChoreStory && (
            <div style={{ marginTop: 8 }}>
              <a
                href={`/chores?search=${encodeURIComponent(node.id)}`}
                style={{ fontSize: 11, color: '#a0aec0', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#2d3748', borderRadius: 4, border: '1px solid #4a5568' }}
                aria-label={`View chore task for story ${node.id}`}
              >
                ⚙ View chore task →
              </a>
            </div>
          )}
        </div>
      )}

      {isExpanded && children.map(child => (
        <StoryNodeCard key={child.id} node={child} allNodes={allNodes} depth={depth + 1} choreStoryIds={choreStoryIds} />
      ))}
    </div>
  );
}

function StoriesContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { data: stories, isLoading, error, mutate } = useSWR<StoryNode[]>('/api/stories-proxy', fetcher, { refreshInterval: 30000 });
  const { data: choreTasks } = useSWR<ChoreTask[]>('/api/chores', fetcher, { refreshInterval: 30000 });
  const choreStoryIds = new Set(choreTasks?.filter((t) => t.storyId).map((t) => t.storyId!) ?? []);

  const projectFilter = searchParams.get('project') ?? '';
  const kindFilter = searchParams.get('kind') ?? '';

  function setFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/stories?${p.toString()}`);
  }

  if (isLoading) return <div style={{ color: '#a0aec0', padding: 24 }}>Loading stories...</div>;
  if (error) return <div style={{ color: '#fc8181', padding: 24 }}>Failed to load stories. Is Conductor running?</div>;

  const allNodes = stories ?? [];
  const filtered = allNodes
    .filter(n => !projectFilter || n.projectSlug === projectFilter)
    .filter(n => !kindFilter || n.kind === kindFilter);

  const projects = [...new Set(allNodes.filter(n => n.projectSlug).map(n => n.projectSlug!))];
  const kinds = [...new Set(allNodes.map(n => n.kind))].sort();
  const roots = buildForest(filtered);

  const totalNodes = allNodes.length;
  const byStatus = {
    pending: allNodes.filter(n => n.status === 'pending').length,
    verified: allNodes.filter(n => n.status === 'verified').length,
    failed: allNodes.filter(n => n.status === 'failed').length,
    partial: allNodes.filter(n => n.status === 'partial').length,
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#90cdf4' }}>🌳 Story Trees</h1>
        <span style={{ color: '#718096', fontSize: 14 }}>{totalNodes} nodes across {roots.length} epics</span>
        <button
          onClick={() => mutate()}
          style={{ marginLeft: 'auto', background: '#2d3748', border: 'none', color: '#90cdf4', borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}
        >
          Refresh
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {Object.entries(byStatus).map(([status, count]) => (
          <div key={status} style={{ background: '#1a1f2e', border: `1px solid ${STATUS_COLOR[status]}33`, borderRadius: 8, padding: '8px 16px', minWidth: 80, textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: STATUS_COLOR[status] }}>{count}</div>
            <div style={{ fontSize: 11, color: '#718096', textTransform: 'uppercase' }}>{status}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={projectFilter}
          onChange={e => setFilter('project', e.target.value)}
          style={{ background: '#1a1f2e', border: '1px solid #4a5568', color: '#e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
          aria-label="Filter by project"
        >
          <option value="">All projects</option>
          {projects.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={kindFilter}
          onChange={e => setFilter('kind', e.target.value)}
          style={{ background: '#1a1f2e', border: '1px solid #4a5568', color: '#e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 13 }}
          aria-label="Filter by kind"
        >
          <option value="">All kinds</option>
          {kinds.map(k => (
            <option key={k} value={k}>{k.replace('_', ' ')}</option>
          ))}
        </select>
        {(projectFilter || kindFilter) && (
          <button
            onClick={() => { setFilter('project', ''); setFilter('kind', ''); }}
            style={{ background: 'none', border: '1px solid #4a5568', color: '#a0aec0', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
            aria-label="Clear filters"
          >
            ✕ Clear filters
          </button>
        )}
      </div>

      {roots.length === 0 ? (
        <div data-test-region="stories-empty" style={{ color: '#718096', padding: 40, textAlign: 'center', border: '1px dashed #4a5568', borderRadius: 8 }}>
          No story trees yet. Use the <code>story_decompose</code> MCP tool to create one.
        </div>
      ) : (
        <div data-test-region="stories-tree">
          {roots.map(root => (
            <div key={root.id} style={{ marginBottom: 16 }}>
              <StoryNodeCard node={root} allNodes={filtered} depth={0} choreStoryIds={choreStoryIds} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StoriesPage() {
  return (
    <Suspense fallback={<div style={{ color: '#a0aec0', padding: 24 }}>Loading stories...</div>}>
      <StoriesContent />
    </Suspense>
  );
}
