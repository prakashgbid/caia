'use client';
/**
 * Buckets kanban (GATE-4-02).
 *
 * Two-column kanban: parallel pool on the left, sequential per-domain
 * queues on the right (one card per bucket, grouped by domain). Click
 * a bucket to drill into its full story list. Live-refreshes on every
 * `task-scheduler.bucket-placed` and `ticket.*` event.
 *
 * Why kanban (and not a tree)? Buckets are queues — kanban is the
 * industry-standard for queues, while a tree implies hierarchy. The
 * directive permits a product-level UI choice provided we document it
 * here. Sequential buckets have an inherent order; we render them
 * stacked by sequenceIndex inside their domain column.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useWebSocket } from '../../hooks/useWebSocket';

const WS_URL = process.env['NEXT_PUBLIC_WS_URL'] ?? 'ws://localhost:7776/events';

interface BucketRow {
  id: string;
  kind: string;
  domainSlug: string | null;
  sequenceIndex: number | null;
  status: string;
  promptId: string;
  createdAt: number;
  ticketCount: number;
  validTicketCount: number;
  preview: Array<{ id: string; title: string; status: string; templateValidationStatus: string }>;
}

interface BucketsResponse {
  total: number;
  buckets: BucketRow[];
  grouped: { sequential: BucketRow[]; parallel: BucketRow[] };
}

interface BucketDetail {
  bucket: { id: string; kind: string; domainSlug: string | null; promptId: string; status: string; sequenceIndex: number | null; createdAt: number };
  prompt: { id: string; body: string; status: string; receivedAt: string } | null;
  stories: Array<{ id: string; title: string; kind: string; status: string; ordinal: number; templateValidationStatus: string; templateVersion: string }>;
}

const BUCKET_TRIGGERS = ['task-scheduler.', 'ticket.'];
function isBucketEvent(type: string | undefined): boolean {
  if (!type) return false;
  return BUCKET_TRIGGERS.some((p) => type.startsWith(p));
}

function StatusPill({ status }: { status: string }) {
  const colors: Record<string, string> = {
    open: '#3182ce', in_progress: '#dd6b20', drained: '#4a5568',
  };
  return (
    <span style={{
      fontSize: 10, padding: '2px 6px', borderRadius: 3,
      background: colors[status] ?? '#4a5568', color: '#fff',
    }}>{status}</span>
  );
}

function ValidityPill({ status }: { status: string }) {
  const bg = status === 'valid' ? '#2f855a'
            : status === 'invalid' ? '#c53030'
            : '#4a5568';
  return (
    <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: bg, color: '#fff' }}>
      {status}
    </span>
  );
}

function BucketCard({
  b,
  onClick,
  selected,
}: {
  b: BucketRow;
  onClick: (id: string) => void;
  selected: boolean;
}) {
  const accent = b.kind === 'sequential' ? '#f6ad55' : '#63b3ed';
  return (
    <div
      data-testid={`bucket-card-${b.id}`}
      data-bucket-kind={b.kind}
      data-bucket-domain={b.domainSlug ?? 'pool'}
      onClick={() => onClick(b.id)}
      style={{
        background: selected ? '#1f2937' : '#1a1f2e',
        border: `1px solid ${selected ? accent : '#2d3748'}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 8,
        cursor: 'pointer',
        transition: 'background 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ color: accent, fontWeight: 600, fontSize: 13 }}>
          {b.domainSlug ?? 'parallel pool'}
          {b.sequenceIndex != null && (
            <span style={{ color: '#a0aec0', marginLeft: 6 }}>#{b.sequenceIndex}</span>
          )}
        </span>
        <StatusPill status={b.status} />
        <span style={{ marginLeft: 'auto', color: '#a0aec0', fontSize: 11 }}>
          {b.ticketCount} ticket{b.ticketCount === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ color: '#718096', fontSize: 11, marginBottom: 6 }}>
        prompt <Link href={`/prompts/${b.promptId}/journey`} onClick={(e) => e.stopPropagation()} style={{ color: '#90cdf4' }}>
          {b.promptId.slice(0, 14)}
        </Link>
        {' · '}
        <span style={{ color: b.validTicketCount === b.ticketCount && b.ticketCount > 0 ? '#68d391' : '#a0aec0' }}>
          {b.validTicketCount}/{b.ticketCount} valid
        </span>
      </div>
      {b.preview.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
          {b.preview.map((s) => (
            <li key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#cbd5e0', fontSize: 11, padding: '2px 0' }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.title}
              </span>
              <ValidityPill status={s.templateValidationStatus} />
            </li>
          ))}
          {b.ticketCount > b.preview.length && (
            <li style={{ color: '#718096', fontSize: 10, marginTop: 2 }}>
              + {b.ticketCount - b.preview.length} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function BucketDetailPanel({ id }: { id: string }) {
  const [data, setData] = useState<BucketDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null); setErr(null);
    fetch(`/api/buckets/${id}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((d: BucketDetail) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setErr(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [id]);

  if (err) return <div style={{ color: '#fc8181' }}>Failed to load bucket: {err}</div>;
  if (!data) return <div style={{ color: '#a0aec0' }}>Loading…</div>;

  return (
    <div data-testid="bucket-detail-panel">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <h3 style={{ margin: 0, color: '#e2e8f0' }}>
          {data.bucket.domainSlug ?? 'parallel pool'}
          {data.bucket.sequenceIndex != null && (
            <span style={{ color: '#a0aec0', marginLeft: 6, fontSize: 14 }}>#{data.bucket.sequenceIndex}</span>
          )}
        </h3>
        <span style={{ color: '#a0aec0', fontSize: 12 }}>
          {data.bucket.kind} bucket · {data.stories.length} ticket{data.stories.length === 1 ? '' : 's'}
        </span>
      </div>
      {data.prompt && (
        <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 6, padding: '8px 12px', marginBottom: 12 }}>
          <div style={{ color: '#a0aec0', fontSize: 11, marginBottom: 4 }}>From prompt</div>
          <Link href={`/prompts/${data.prompt.id}/journey`} style={{ color: '#90cdf4', fontSize: 13 }}>
            {data.prompt.body.slice(0, 100)}{data.prompt.body.length > 100 ? '…' : ''}
          </Link>
        </div>
      )}
      <div>
        {data.stories.map((s) => (
          <div
            key={s.id}
            data-testid={`bucket-detail-story-${s.id}`}
            style={{
              background: '#1a1f2e',
              border: '1px solid #2d3748',
              borderRadius: 6,
              padding: '10px 12px',
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ color: '#a0aec0', fontSize: 11 }}>#{s.ordinal}</span>
              <Link href={`/stories/${encodeURIComponent(s.id)}`} style={{ color: '#e2e8f0', fontWeight: 600, textDecoration: 'none' }}>
                {s.title}
              </Link>
              <ValidityPill status={s.templateValidationStatus} />
            </div>
            <div style={{ color: '#718096', fontSize: 11 }}>
              {s.kind} · status {s.status} · template {s.templateVersion}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function BucketsPage() {
  const [data, setData] = useState<BucketsResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { lastEvent, connected } = useWebSocket(WS_URL);

  const refetch = useCallback(async () => {
    try {
      const r = await fetch('/api/buckets', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json() as BucketsResponse;
      setData(d);
      setErr(null);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  useEffect(() => {
    if (!lastEvent) return;
    if (isBucketEvent(lastEvent.type ?? lastEvent.kind)) void refetch();
  }, [lastEvent, refetch]);

  const sequentialByDomain = new Map<string, BucketRow[]>();
  for (const b of data?.grouped.sequential ?? []) {
    const key = b.domainSlug ?? 'unknown';
    const arr = sequentialByDomain.get(key) ?? [];
    arr.push(b);
    sequentialByDomain.set(key, arr);
  }
  // Sort sequential per-domain buckets by sequenceIndex.
  for (const arr of sequentialByDomain.values()) {
    arr.sort((a, b) => (a.sequenceIndex ?? 0) - (b.sequenceIndex ?? 0));
  }

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>🗂️ Task Buckets</h1>
        {data && <span style={{ color: '#718096', fontSize: 13 }}>{data.total} bucket{data.total === 1 ? '' : 's'}</span>}
        <span style={{ marginLeft: 'auto', color: connected ? '#68d391' : '#fc8181', fontSize: 12 }}>
          {connected ? '● live' : '○ reconnecting…'}
        </span>
        <button
          onClick={() => void refetch()}
          style={{
            background: '#2d3748', border: '1px solid #4a5568', color: '#a0aec0',
            borderRadius: 4, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {err && <div style={{ color: '#fc8181', marginBottom: 12 }}>Error: {err}</div>}

      {/* Legend */}
      <div style={{
        background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 6,
        padding: '10px 14px', marginBottom: 16, color: '#718096', fontSize: 12,
      }}>
        <span style={{ color: '#63b3ed', fontWeight: 700, marginRight: 8 }}>parallel</span>
        tickets with no cross-domain upstream — execute concurrently.
        <span style={{ marginLeft: 16, color: '#f6ad55', fontWeight: 700, marginRight: 8 }}>sequential</span>
        per-domain queues — topologically ordered by sequenceIndex.
      </div>

      {/* Kanban: parallel left, sequential right (grouped by domain) */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr 380px', gap: 16, alignItems: 'start' }}>
        {/* Parallel column */}
        <div data-testid="bucket-column-parallel" style={{ background: '#10202c', border: '1px solid #63b3ed44', borderRadius: 8, padding: 12 }}>
          <div style={{ color: '#63b3ed', fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
            🟦 parallel pool ({data?.grouped.parallel.length ?? 0})
          </div>
          {(data?.grouped.parallel ?? []).map((b) => (
            <BucketCard key={b.id} b={b} onClick={setSelected} selected={selected === b.id} />
          ))}
          {(data?.grouped.parallel.length ?? 0) === 0 && (
            <div style={{ color: '#4a5568', fontSize: 12, fontStyle: 'italic' }}>no parallel buckets yet</div>
          )}
        </div>

        {/* Sequential columns — one per domain */}
        <div
          data-testid="bucket-column-sequential"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}
        >
          {[...sequentialByDomain.entries()].map(([domain, buckets]) => (
            <div key={domain} data-testid={`bucket-column-domain-${domain}`} style={{ background: '#2c2410', border: '1px solid #f6ad5544', borderRadius: 8, padding: 12 }}>
              <div style={{ color: '#f6ad55', fontWeight: 700, fontSize: 13, marginBottom: 10 }}>
                ⏩ {domain} ({buckets.length})
              </div>
              {buckets.map((b) => (
                <BucketCard key={b.id} b={b} onClick={setSelected} selected={selected === b.id} />
              ))}
            </div>
          ))}
          {sequentialByDomain.size === 0 && (
            <div style={{ color: '#4a5568', fontSize: 12, fontStyle: 'italic', padding: 16 }}>no sequential buckets yet</div>
          )}
        </div>

        {/* Detail rail */}
        <div style={{ background: '#0f1117', border: '1px solid #2d3748', borderRadius: 8, padding: 16, position: 'sticky', top: 0 }}>
          {selected
            ? <BucketDetailPanel id={selected} />
            : <div style={{ color: '#4a5568', fontSize: 12, fontStyle: 'italic' }}>Select a bucket to see its tickets</div>
          }
        </div>
      </div>
    </div>
  );
}
