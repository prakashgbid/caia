'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { VerbIntentBadge, type VerbIntent } from './VerbIntentBadge';

type RequirementState =
  | 'captured' | 'refining' | 'specced' | 'ready'
  | 'executing' | 'verifying' | 'done' | 'blocked' | 'cancelled';

interface RequirementSpec {
  goals: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  notes: string;
}

interface RequirementNote {
  ts: string;
  text: string;
}

interface Requirement {
  id: string;
  title: string;
  description: string;
  capturedAt: string;
  updatedAt: string;
  state: RequirementState;
  priority: 1 | 2 | 3 | 4 | 5;
  labels: string[];
  dependsOn: string[];
  targetProject?: string;
  estimatedFiles: string[];
  spec?: RequirementSpec;
  linkedTaskIds: string[];
  notes: RequirementNote[];
  verbIntent?: VerbIntent;
}

const COLUMNS: RequirementState[] = [
  'captured', 'refining', 'specced', 'ready',
  'executing', 'verifying', 'done', 'blocked', 'cancelled',
];

const COLUMN_COLORS: Record<RequirementState, string> = {
  captured:  '#4a5568',
  refining:  '#2b6cb0',
  specced:   '#2c7a7b',
  ready:     '#276749',
  executing: '#744210',
  verifying: '#553c9a',
  done:      '#22543d',
  blocked:   '#742a2a',
  cancelled: '#2d3748',
};

const PRIORITY_COLORS = ['', '#fc8181', '#f6ad55', '#faf089', '#9ae6b4', '#90cdf4'];
const PRIORITY_LABELS = ['', 'P1', 'P2', 'P3', 'P4', 'P5'];

const fetcher = (url: string) => fetch(url).then(r => r.json());

const styles = {
  container: { padding: '0' },
  topBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
    flexWrap: 'wrap' as const,
  },
  filterChip: {
    padding: '4px 10px',
    borderRadius: '12px',
    border: '1px solid #4a5568',
    background: 'transparent',
    color: '#e2e8f0',
    cursor: 'pointer',
    fontSize: '12px',
  },
  filterChipActive: {
    background: '#2b6cb0',
    borderColor: '#2b6cb0',
  },
  createBtn: {
    marginLeft: 'auto',
    padding: '6px 14px',
    background: '#2b6cb0',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
  board: {
    display: 'flex',
    gap: '12px',
    overflowX: 'auto' as const,
    paddingBottom: '8px',
  },
  column: {
    minWidth: '200px',
    maxWidth: '220px',
    flexShrink: 0 as const,
    background: '#1a202c',
    borderRadius: '8px',
    padding: '10px',
  },
  columnHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  columnTitle: {
    fontSize: '11px',
    fontWeight: '700',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    color: '#a0aec0',
  },
  columnCount: {
    fontSize: '11px',
    color: '#718096',
    background: '#2d3748',
    padding: '2px 6px',
    borderRadius: '10px',
  },
  card: {
    background: '#2d3748',
    borderRadius: '6px',
    padding: '8px',
    marginBottom: '6px',
    cursor: 'pointer',
    borderLeft: '3px solid transparent',
  },
  cardTitle: { fontSize: '13px', color: '#f7fafc', fontWeight: '500', lineHeight: 1.3 },
  cardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '4px',
    flexWrap: 'wrap' as const,
  },
  badge: {
    fontSize: '10px',
    padding: '1px 5px',
    borderRadius: '4px',
    background: '#4a5568',
    color: '#e2e8f0',
  },
  priorityDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
  },
  drawer: {
    position: 'fixed' as const,
    top: 0, right: 0, bottom: 0,
    width: '420px',
    background: '#1a202c',
    borderLeft: '1px solid #2d3748',
    padding: '24px',
    overflowY: 'auto' as const,
    zIndex: 100,
  },
  drawerTitle: { fontSize: '18px', fontWeight: '700', color: '#f7fafc', marginBottom: '4px' },
  drawerLabel: { fontSize: '11px', color: '#718096', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginTop: '14px', marginBottom: '4px' },
  drawerValue: { fontSize: '13px', color: '#e2e8f0', lineHeight: 1.5 },
  closeBtn: {
    position: 'absolute' as const,
    top: '16px',
    right: '16px',
    background: 'none',
    border: 'none',
    color: '#718096',
    cursor: 'pointer',
    fontSize: '18px',
  },
  modal: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 200,
  },
  modalBox: {
    background: '#1a202c',
    border: '1px solid #2d3748',
    borderRadius: '10px',
    padding: '24px',
    width: '480px',
    maxWidth: '90vw',
  },
  modalTitle: { fontSize: '16px', fontWeight: '700', color: '#f7fafc', marginBottom: '16px' },
  formRow: { marginBottom: '12px' },
  label: { display: 'block', fontSize: '12px', color: '#a0aec0', marginBottom: '4px' },
  input: {
    width: '100%',
    background: '#2d3748',
    border: '1px solid #4a5568',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#f7fafc',
    fontSize: '13px',
    boxSizing: 'border-box' as const,
  },
  textarea: {
    width: '100%',
    background: '#2d3748',
    border: '1px solid #4a5568',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#f7fafc',
    fontSize: '13px',
    boxSizing: 'border-box' as const,
    resize: 'vertical' as const,
    minHeight: '80px',
  },
  row: { display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' },
  cancelBtn: {
    padding: '7px 16px',
    background: 'transparent',
    border: '1px solid #4a5568',
    borderRadius: '6px',
    color: '#a0aec0',
    cursor: 'pointer',
    fontSize: '13px',
  },
  submitBtn: {
    padding: '7px 16px',
    background: '#2b6cb0',
    border: 'none',
    borderRadius: '6px',
    color: '#fff',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: '600',
  },
} as const;

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ title: '', description: '', targetProject: '', priority: '3', labels: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!form.title || !form.description) { setError('Title and description required'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          targetProject: form.targetProject || undefined,
          priority: parseInt(form.priority, 10) || 3,
          labels: form.labels ? form.labels.split(',').map(l => l.trim()).filter(Boolean) : [],
        }),
      });
      if (!res.ok) { setError(await res.text()); return; }
      onCreated();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.modal} onClick={onClose}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <p style={styles.modalTitle}>New Requirement</p>
        {error && <p style={{ color: '#fc8181', fontSize: '12px', marginBottom: '8px' }}>{error}</p>}
        <div style={styles.formRow}>
          <label style={styles.label}>Title *</label>
          <input style={styles.input} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Short label..." />
        </div>
        <div style={styles.formRow}>
          <label style={styles.label}>Description *</label>
          <textarea style={styles.textarea} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What do you need?" />
        </div>
        <div style={styles.formRow}>
          <label style={styles.label}>Target project path</label>
          <input style={styles.input} value={form.targetProject} onChange={e => setForm(f => ({ ...f, targetProject: e.target.value }))} placeholder="~/Documents/projects/my-app" />
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ ...styles.formRow, flex: 1 }}>
            <label style={styles.label}>Priority (1=top, 5=low)</label>
            <input style={styles.input} type="number" min="1" max="5" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} />
          </div>
          <div style={{ ...styles.formRow, flex: 2 }}>
            <label style={styles.label}>Labels (comma-separated)</label>
            <input style={styles.input} value={form.labels} onChange={e => setForm(f => ({ ...f, labels: e.target.value }))} placeholder="ui, backend, api" />
          </div>
        </div>
        <div style={styles.row}>
          <button style={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button style={styles.submitBtn} onClick={handleSubmit} disabled={loading}>
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RequirementDrawer({ req, onClose }: { req: Requirement; onClose: () => void }) {
  return (
    <div style={styles.drawer}>
      <button style={styles.closeBtn} onClick={onClose}>✕</button>
      <p style={styles.drawerTitle}>{req.title}</p>
      <span style={{ ...styles.badge, background: COLUMN_COLORS[req.state], color: '#fff', fontSize: '11px' }}>
        {req.state}
      </span>
      {'  '}
      <span style={{ ...styles.badge, background: PRIORITY_COLORS[req.priority] ?? '#718096', color: '#1a202c', fontSize: '11px' }}>
        {PRIORITY_LABELS[req.priority]}
      </span>
      {req.verbIntent && <>{'  '}<VerbIntentBadge intent={req.verbIntent} size="md" /></>}
      <p style={styles.drawerLabel}>ID</p>
      <p style={{ ...styles.drawerValue, fontFamily: 'monospace', fontSize: '12px' }}>{req.id}</p>
      <p style={styles.drawerLabel}>Description</p>
      <p style={styles.drawerValue}>{req.description}</p>
      {req.targetProject && <>
        <p style={styles.drawerLabel}>Target project</p>
        <p style={{ ...styles.drawerValue, fontFamily: 'monospace', fontSize: '12px' }}>{req.targetProject}</p>
      </>}
      {req.labels.length > 0 && <>
        <p style={styles.drawerLabel}>Labels</p>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {req.labels.map(l => <span key={l} style={styles.badge}>{l}</span>)}
        </div>
      </>}
      {req.spec && <>
        <p style={styles.drawerLabel}>Goals</p>
        <ul style={{ paddingLeft: '16px' }}>{req.spec.goals.map((g, i) => <li key={i} style={styles.drawerValue}>{g}</li>)}</ul>
        <p style={styles.drawerLabel}>Acceptance Criteria</p>
        <ul style={{ paddingLeft: '16px' }}>{req.spec.acceptanceCriteria.map((c, i) => <li key={i} style={styles.drawerValue}>{c}</li>)}</ul>
      </>}
      {req.estimatedFiles.length > 0 && <>
        <p style={styles.drawerLabel}>Estimated files</p>
        <p style={{ ...styles.drawerValue, fontFamily: 'monospace', fontSize: '11px' }}>{req.estimatedFiles.join(', ')}</p>
      </>}
      {req.dependsOn.length > 0 && <>
        <p style={styles.drawerLabel}>Depends on</p>
        {req.dependsOn.map(d => <span key={d} style={{ ...styles.badge, display: 'inline-block', marginRight: '4px', marginBottom: '4px' }}>{d}</span>)}
      </>}
      {req.linkedTaskIds.length > 0 && <>
        <p style={styles.drawerLabel}>Linked tasks</p>
        {req.linkedTaskIds.map(t => <span key={t} style={{ ...styles.badge, display: 'inline-block', marginRight: '4px', marginBottom: '4px' }}>{t}</span>)}
      </>}
      {req.notes.length > 0 && <>
        <p style={styles.drawerLabel}>Notes</p>
        {req.notes.map((n, i) => (
          <div key={i} style={{ marginBottom: '6px' }}>
            <span style={{ fontSize: '10px', color: '#718096' }}>{new Date(n.ts).toLocaleString()}</span>
            <p style={{ ...styles.drawerValue, marginTop: '2px' }}>{n.text}</p>
          </div>
        ))}
      </>}
      <p style={styles.drawerLabel}>Captured</p>
      <p style={{ ...styles.drawerValue, fontSize: '11px' }}>{new Date(req.capturedAt).toLocaleString()}</p>
    </div>
  );
}

const VERB_INTENTS: VerbIntent[] = ['fix', 'refactor', 'extract', 'audit', 'spike', 'add'];

export function RequirementsKanban() {
  const { data: reqs = [], mutate: reload } = useSWR<Requirement[]>('/api/requirements', fetcher, { refreshInterval: 3000 });
  const [selected, setSelected] = useState<Requirement | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [stateFilter, setStateFilter] = useState<RequirementState | null>(null);
  const [intentFilter, setIntentFilter] = useState<VerbIntent | null>(null);

  const filteredReqs = intentFilter ? reqs.filter(r => r.verbIntent === intentFilter) : reqs;

  const byState: Record<RequirementState, Requirement[]> = {} as Record<RequirementState, Requirement[]>;
  for (const s of COLUMNS) byState[s] = [];
  for (const r of filteredReqs) {
    if (byState[r.state]) byState[r.state].push(r);
  }

  const visibleCols = stateFilter ? COLUMNS.filter(c => c === stateFilter) : COLUMNS;

  const handleDrop = async (reqId: string, toState: RequirementState) => {
    try {
      await fetch(`/api/requirements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ _setStateId: reqId, state: toState }),
      });
      await reload();
    } catch {
      // ignore drag errors
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.topBar}>
        <span style={{ fontSize: '12px', color: '#718096' }}>State:</span>
        {COLUMNS.map(s => (
          <button
            key={s}
            style={{
              ...styles.filterChip,
              ...(stateFilter === s ? styles.filterChipActive : {}),
            }}
            onClick={() => setStateFilter(stateFilter === s ? null : s)}
          >
            {s}
            {byState[s].length > 0 && ` (${byState[s].length})`}
          </button>
        ))}
      </div>
      <div style={{ ...styles.topBar, marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', color: '#718096' }}>Intent:</span>
        {VERB_INTENTS.map(v => (
          <button
            key={v}
            style={{
              ...styles.filterChip,
              ...(intentFilter === v ? styles.filterChipActive : {}),
              padding: '3px 8px',
            }}
            onClick={() => setIntentFilter(intentFilter === v ? null : v)}
          >
            <VerbIntentBadge intent={v} size="sm" />
          </button>
        ))}
        <button style={styles.createBtn} onClick={() => setShowCreate(true)}>+ New Requirement</button>
      </div>

      <div style={styles.board}>
        {visibleCols.map(colState => (
          <div
            key={colState}
            style={styles.column}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              const id = e.dataTransfer.getData('text/plain');
              if (id) void handleDrop(id, colState);
            }}
          >
            <div style={styles.columnHeader}>
              <span style={{ ...styles.columnTitle, color: COLUMN_COLORS[colState] }}>{colState}</span>
              <span style={styles.columnCount}>{byState[colState].length}</span>
            </div>
            {byState[colState].map(req => (
              <div
                key={req.id}
                style={{ ...styles.card, borderLeftColor: COLUMN_COLORS[colState] }}
                draggable
                onDragStart={e => e.dataTransfer.setData('text/plain', req.id)}
                onClick={() => setSelected(req)}
              >
                <p style={styles.cardTitle}>{req.title}</p>
                <div style={styles.cardMeta}>
                  <span style={{
                    ...styles.priorityDot,
                    background: PRIORITY_COLORS[req.priority] ?? '#718096',
                  }} />
                  {req.verbIntent && <VerbIntentBadge intent={req.verbIntent} size="sm" />}
                  {req.labels.slice(0, 2).map(l => <span key={l} style={styles.badge}>{l}</span>)}
                  {req.linkedTaskIds.length > 0 && (
                    <span style={{ ...styles.badge, background: '#553c9a' }}>
                      {req.linkedTaskIds.length} task{req.linkedTaskIds.length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {selected && (
        <RequirementDrawer
          req={selected}
          onClose={() => setSelected(null)}
        />
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => void reload()}
        />
      )}
    </div>
  );
}
