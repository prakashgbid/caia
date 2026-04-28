'use client';
/**
 * Prompt journey page (extended for Gate 4).
 *
 * Renders the original journey summary (timing, status distribution,
 * descendants) plus a live Phase-1 timeline. Subscribes to the WS bus
 * and refetches the Phase-1 payload whenever a Phase-1 event arrives
 * for this prompt — that gives the user a live view of every stage
 * as it happens, end-to-end (PO → BA → Task Manager → bucket placed).
 */
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useWebSocket } from '../../../../hooks/useWebSocket';
import { Phase1Timeline, type Phase1Payload } from '../../../../components/Phase1Timeline';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';
const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:7776/events';

interface Journey {
  promptId: string;
  receivedAt: string;
  status: string;
  elapsedMs?: number | null;
  timeToFirstTaskMs?: number | null;
  timeToAllDoneMs?: number | null;
  countByStatus: Record<string, number>;
  circuitBreakerTrips: number;
  reExecutionCount: number;
  totalEvents: number;
  descendants: {
    stories: number;
    requirements: number;
    tasks: number;
    taskRuns: number;
    blockers: number;
    questions: number;
    total: number;
  };
}

const STATUS_COLOR: Record<string, string> = {
  received: '#6b7280', analyzing: '#2563eb', decomposed: '#7c3aed',
  answered: '#16a34a', failed: '#dc2626',
  queued: '#9ca3af', running: '#2563eb', completed: '#16a34a',
  blocked: '#f59e0b', done: '#16a34a', pending: '#9ca3af',
  ingested: '#6b7280', scaffolded: '#3182ce',
  po_decomposed: '#805ad5', ba_enriched: '#dd6b20',
  bucket_placed: '#38a169', ready_for_pickup: '#16a34a',
};

function ms(v?: number | null): string {
  if (v == null) return '—';
  if (v < 1000) return `${v}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  return `${(v / 60_000).toFixed(1)}m`;
}

/**
 * Phase-1 event prefixes that should trigger a refetch of /phase1.
 * Listed explicitly so that unrelated tab-traffic never wakes this page up.
 */
const PHASE1_TRIGGERS = [
  'pipeline.stage.advanced',
  'po-agent.',
  'ba-agent.',
  'task-scheduler.',
  'ticket.',
  'scaffolder.team.assembled',
  'prompt.ingested',
  'prompt.status_changed',
];

function isPhase1EventType(type: string | undefined): boolean {
  if (!type) return false;
  return PHASE1_TRIGGERS.some((p) => type === p || type.startsWith(p));
}

export default function PromptJourneyPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [journey, setJourney] = useState<Journey | null>(null);
  const [phase1, setPhase1] = useState<Phase1Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const { lastEvent, connected } = useWebSocket(WS_URL);

  const refetch = useCallback(async () => {
    const [j, p] = await Promise.all([
      fetch(`${API}/prompts/${id}/journey`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(`/api/prompts/${id}/phase1`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (j) setJourney(j as Journey);
    if (p) setPhase1(p as Phase1Payload);
    setLoading(false);
  }, [id]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Live refetch: when a Phase-1 event arrives whose correlation_id
  // matches this prompt (or a per-story sub-correlation), refetch.
  useEffect(() => {
    if (!lastEvent) return;
    if (!isPhase1EventType(lastEvent.type ?? lastEvent.kind)) return;
    // Some events arrive without an explicit correlationId on the
    // legacy envelope. The orchestrator stamps it for Phase 1, so we
    // can be strict here.
    const corrCandidate = (lastEvent.payload as Record<string, unknown> | undefined)?.['correlationId']
      ?? (lastEvent.payload as Record<string, unknown> | undefined)?.['correlation_id']
      ?? (lastEvent as unknown as Record<string, unknown>)['correlationId']
      ?? (lastEvent as unknown as Record<string, unknown>)['correlation_id'];
    const promptCorr = phase1?.prompt.correlationId ?? id;
    const matches = !corrCandidate ||
      corrCandidate === promptCorr ||
      (typeof corrCandidate === 'string' && corrCandidate.startsWith(`${promptCorr}::`));
    if (matches) void refetch();
  }, [lastEvent, refetch, phase1?.prompt.correlationId, id]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading…</div>;
  if (!journey) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#fc8181', marginBottom: 12 }}>Prompt not found</div>
      <Link href="/prompts" style={{ color: '#63b3ed' }}>← Back</Link>
    </div>
  );

  const statusEntries = Object.entries(journey.countByStatus).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(...statusEntries.map((e) => e[1]), 1);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 12 }}>
        <Link href="/prompts" style={{ color: '#6b7280' }}>Prompts</Link>
        {' → '}
        <Link href={`/prompts/${id}`} style={{ color: '#6b7280' }}>{id.slice(0, 20)}</Link>
        {' → '}
        Journey
        <span style={{ marginLeft: 12, color: connected ? '#68d391' : '#fc8181' }}>
          {connected ? '● live' : '○ reconnecting…'}
        </span>
      </div>

      <h2 style={{ marginBottom: 20 }}>Prompt Journey — #{id.slice(0, 14)}</h2>

      {/* Phase 1 panel — the meat of Gate 4 */}
      {phase1 && (
        <div
          data-testid="phase1-panel"
          style={{
            background: '#0f1117',
            border: '1px solid #2d3748',
            borderRadius: 8,
            padding: 18,
            marginBottom: 28,
          }}
        >
          <Phase1Timeline data={phase1} />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
        {[
          ['Status', journey.status],
          ['Total elapsed', ms(journey.elapsedMs)],
          ['→ First task', ms(journey.timeToFirstTaskMs)],
          ['→ All done', ms(journey.timeToAllDoneMs)],
          ['Total events', String(journey.totalEvents)],
          ['Circuit breaker trips', String(journey.circuitBreakerTrips)],
          ['Re-executions', String(journey.reExecutionCount)],
          ['Total descendants', String(journey.descendants.total)],
        ].map(([label, val]) => (
          <div key={String(label)} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1f2937', fontFamily: 'monospace' }}>{val}</div>
          </div>
        ))}
      </div>

      <h3 style={{ marginBottom: 12 }}>Descendants by type</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        {Object.entries(journey.descendants).filter(([k]) => k !== 'total').map(([type, cnt]) => (
          <div key={type} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px', minWidth: 100 }}>
            <div style={{ color: '#6b7280', fontSize: 11 }}>{type}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1f2937' }}>{cnt}</div>
          </div>
        ))}
      </div>

      {statusEntries.length > 0 && (
        <>
          <h3 style={{ marginBottom: 12 }}>Status distribution</h3>
          <div style={{ marginBottom: 28 }}>
            {statusEntries.map(([status, cnt]) => (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 100, textAlign: 'right', color: '#374151', fontSize: 12 }}>{status}</div>
                <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 4, height: 20, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(cnt / maxCount) * 100}%`,
                    height: 20,
                    background: STATUS_COLOR[status] ?? '#6b7280',
                    borderRadius: 4,
                  }} />
                </div>
                <div style={{ width: 32, fontSize: 12, color: '#6b7280' }}>{cnt}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <h3 style={{ marginBottom: 12 }}>Status journey (lifecycle)</h3>
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: 12, color: '#374151' }}>
        <div>Phase 1: ingested → scaffolded → po_decomposed → ba_enriched → bucket_placed → ready_for_pickup</div>
        <div style={{ marginTop: 8 }}>Task: queued → ready → dispatched → running → gate_pending → gate_passed → sentinel_pending → sentinel_passed → done</div>
        <div style={{ marginTop: 8, color: '#9ca3af' }}>Side branches: gate_failed → rework_queued → ready | sentinel_flagged → bug_filed | paused | blocked | cancelled</div>
      </div>
    </div>
  );
}
