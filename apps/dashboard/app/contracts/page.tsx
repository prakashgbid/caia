/**
 * /contracts — Agent Section Contract Registry dashboard (ACR-009).
 *
 * Three panels:
 *   1. Scope selector + composed-template summary (signature + count + warnings)
 *   2. Sections table (name, owner, required, severity, minWords, dependencies, fixHint)
 *   3. Registered-contracts table (contractId, owner, version, appliesTo, sectionCount)
 *
 * Polls the orchestrator every 30s. Fail-soft: any panel that 404/500s
 * renders an empty state.
 */
'use client';
import { useEffect, useState } from 'react';

type Scope = 'initiative' | 'epic' | 'module' | 'story' | 'task' | 'subtask';
const SCOPES: Scope[] = ['initiative', 'epic', 'module', 'story', 'task', 'subtask'];

interface SectionRow {
  name: string;
  ownerAgent: string;
  contractId: string;
  effectiveRequired: boolean;
  description: string;
  purpose: string;
  dependencies: string[];
  effectiveRubric: {
    minWords: number | null;
    minItems: number | null;
    severityOnFail: 'hard' | 'soft' | 'warning';
    fixHint: string;
    forbiddenSnippets: string[];
    requiredEntityRefs: Array<{ label: string; pattern: string; flags?: string }>;
  };
  exampleCount: number;
}

interface ComposedResponse {
  scope: string;
  signature: string;
  sectionCount: number;
  sections: SectionRow[];
  warnings: string[];
}

interface RegistryEntry {
  contractId: string;
  ownerAgent: string;
  version: string;
  appliesTo: string[];
  sectionCount: number;
  sectionNames: string[];
}

interface RegistryResponse {
  contracts: RegistryEntry[];
  count: number;
}

const SEVERITY_COLOR: Record<string, string> = {
  hard: '#dc2626',
  soft: '#d97706',
  warning: '#65a30d',
};

const OWNER_COLOR: Record<string, string> = {
  po: '#2563eb',
  ba: '#7c3aed',
  ea: '#db2777',
  'test-design': '#059669',
};

function ownerBadge(owner: string) {
  return (
    <span
      style={{
        background: OWNER_COLOR[owner] ?? '#6b7280',
        color: 'white',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {owner}
    </span>
  );
}

function severityBadge(sev: 'hard' | 'soft' | 'warning') {
  return (
    <span
      style={{
        background: SEVERITY_COLOR[sev] ?? '#6b7280',
        color: 'white',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
      }}
    >
      {sev}
    </span>
  );
}

export default function ContractsPage() {
  const [scope, setScope] = useState<Scope>('story');
  const [composed, setComposed] = useState<ComposedResponse | null>(null);
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [c, r] = await Promise.all([
          fetch(`/api/contracts/composed/${scope}`).then((res) => res.json()),
          fetch('/api/contracts/registry').then((res) => res.json()),
        ]);
        if (!cancelled) {
          setComposed(c as ComposedResponse);
          setRegistry(r as RegistryResponse);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [scope]);

  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
        Agent Section Contract Registry
      </h1>
      <p style={{ color: '#6b7280', marginBottom: 24, maxWidth: 720 }}>
        Each ticket-writing agent (PO, BA, EA, Test-Design) declares a SectionContract
        listing the sections + per-scope rubrics it owns. The Story Validator composes
        contracts at runtime per a story&apos;s scope. New agent? Just register a contract.
      </p>

      <section style={{ marginBottom: 24 }}>
        <label htmlFor="scope-select" style={{ marginRight: 8, fontWeight: 600 }}>
          Story scope:
        </label>
        <select
          id="scope-select"
          value={scope}
          onChange={(e) => setScope(e.target.value as Scope)}
          style={{
            padding: '6px 12px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            fontSize: 14,
          }}
        >
          {SCOPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {composed && (
          <span style={{ marginLeft: 16, color: '#6b7280', fontSize: 13 }}>
            {composed.sectionCount} sections · signature{' '}
            <code style={{ fontSize: 11 }}>{composed.signature.slice(0, 12)}…</code>
          </span>
        )}
      </section>

      {composed && composed.warnings.length > 0 && (
        <section
          style={{
            background: '#fef3c7',
            border: '1px solid #f59e0b',
            padding: 12,
            borderRadius: 6,
            marginBottom: 16,
          }}
        >
          <strong>Composition warnings:</strong>
          <ul>
            {composed.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Composed sections — {scope}
        </h2>
        {loading && <p>Loading…</p>}
        {!loading && composed && composed.sections.length === 0 && (
          <p style={{ color: '#6b7280' }}>
            No sections for scope <strong>{scope}</strong>.
          </p>
        )}
        {composed && composed.sections.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Section</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Owner</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Required</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Severity</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>min</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Depends on</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Fix hint</th>
                </tr>
              </thead>
              <tbody>
                {composed.sections.map((s) => (
                  <tr key={s.name} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8 }}>
                      <code style={{ fontSize: 12 }}>{s.name}</code>
                      <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2 }}>
                        {s.description}
                      </div>
                    </td>
                    <td style={{ padding: 8 }}>{ownerBadge(s.ownerAgent)}</td>
                    <td style={{ padding: 8 }}>{s.effectiveRequired ? 'yes' : 'no'}</td>
                    <td style={{ padding: 8 }}>{severityBadge(s.effectiveRubric.severityOnFail)}</td>
                    <td style={{ padding: 8, color: '#6b7280' }}>
                      {s.effectiveRubric.minWords != null && (
                        <span>w≥{s.effectiveRubric.minWords} </span>
                      )}
                      {s.effectiveRubric.minItems != null && (
                        <span>i≥{s.effectiveRubric.minItems}</span>
                      )}
                    </td>
                    <td style={{ padding: 8, color: '#6b7280', fontSize: 11 }}>
                      {s.dependencies.length > 0 ? s.dependencies.join(', ') : '—'}
                    </td>
                    <td style={{ padding: 8, color: '#6b7280', fontSize: 12, maxWidth: 380 }}>
                      {s.effectiveRubric.fixHint}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>
          Registered contracts ({registry?.count ?? 0})
        </h2>
        {registry && registry.contracts.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#f3f4f6', textAlign: 'left' }}>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Contract</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Owner</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Version</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Applies to</th>
                  <th style={{ padding: 8, borderBottom: '2px solid #e5e7eb' }}>Sections</th>
                </tr>
              </thead>
              <tbody>
                {registry.contracts.map((c) => (
                  <tr key={c.contractId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8 }}>
                      <code style={{ fontSize: 12 }}>{c.contractId}</code>
                    </td>
                    <td style={{ padding: 8 }}>{ownerBadge(c.ownerAgent)}</td>
                    <td style={{ padding: 8, color: '#6b7280' }}>{c.version}</td>
                    <td style={{ padding: 8, color: '#6b7280', fontSize: 11 }}>
                      {c.appliesTo.join(', ')}
                    </td>
                    <td style={{ padding: 8, color: '#6b7280' }}>{c.sectionCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
