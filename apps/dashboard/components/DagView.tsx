'use client';

interface Task {
  id: string;
  title: string;
  status: string;
}

interface DagData {
  nodes: Task[];
  edges: Array<{ from: string; to: string }>;
}

function buildMermaid(dag: DagData): string {
  if (dag.nodes.length === 0) return 'graph LR\n  empty[No tasks]';

  const lines: string[] = ['graph LR'];
  for (const node of dag.nodes) {
    const label = `${node.id}\\n${node.title.substring(0, 20)}`;
    lines.push(`  ${node.id}["${label}"]`);
  }
  for (const edge of dag.edges) {
    lines.push(`  ${edge.from} --> ${edge.to}`);
  }
  return lines.join('\n');
}

export function DagView({ dag }: { dag?: DagData }) {
  const mermaid = dag ? buildMermaid(dag) : 'graph LR\n  loading[Loading...]';

  return (
    <div style={{ background: '#1a202c', borderRadius: '8px', padding: '16px' }}>
      <h2 style={{ marginBottom: '12px', color: '#f7fafc', fontSize: '16px' }}>
        Dependency Graph ({dag?.nodes?.length ?? 0} tasks)
      </h2>
      <pre style={{
        background: '#171923',
        padding: '12px',
        borderRadius: '6px',
        fontSize: '11px',
        fontFamily: 'monospace',
        color: '#a0aec0',
        overflow: 'auto',
        maxHeight: '200px',
        lineHeight: '1.5',
      }}>
        {mermaid}
      </pre>
      {dag && dag.edges.length > 0 && (
        <div style={{ marginTop: '8px', fontSize: '12px', color: '#718096' }}>
          {dag.edges.map((e, i) => (
            <span key={i} style={{ marginRight: '8px' }}>
              {e.from} → {e.to}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
