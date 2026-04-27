'use client';
import { useEffect, useState, useMemo, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Prompt {
  id: string;
  body: string;
  receivedAt: string;
  receivedVia: string;
  status: string;
  completedAt?: string | null;
  elapsedMs?: number | null;
  userId?: string | null;
  sessionId?: string | null;
}

interface PromptsResponse {
  prompts: Prompt[];
  total?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

const STATUS_BADGE: Record<string, { emoji: string; label: string; bg: string; color: string }> = {
  received:   { emoji: '🔵', label: 'Ingested',    bg: '#1a2744', color: '#63b3ed' },
  analyzing:  { emoji: '🟡', label: 'In Progress', bg: '#3d2a00', color: '#f6ad55' },
  decomposed: { emoji: '🟠', label: 'Decomposed',  bg: '#3d2000', color: '#fb923c' },
  answered:   { emoji: '🟢', label: 'Complete',    bg: '#1a3320', color: '#68d391' },
  failed:     { emoji: '🔴', label: 'Failed',      bg: '#3d1515', color: '#fc8181' },
};

function statusFromTasks(status: string): { emoji: string; label: string; bg: string; color: string } {
  return STATUS_BADGE[status] ?? { emoji: '⚪', label: status, bg: '#2d3748', color: '#a0aec0' };
}

const PAGE_SIZE = 25;

// ─── Date filter helpers ────────────────────────────────────────────────────

function filterByDate(prompts: Prompt[], range: string): Prompt[] {
  const now = Date.now();
  const cutoff: Record<string, number> = {
    today: now - 86400000,
    week:  now - 7 * 86400000,
    month: now - 30 * 86400000,
    all:   0,
  };
  const since = cutoff[range] ?? 0;
  return prompts.filter(p => new Date(p.receivedAt).getTime() >= since);
}

// ─── Component ────────────────────────────────────────────────────────────────

function PromptsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchQ = searchParams.get('q') ?? '';
  const dateRange = searchParams.get('date') ?? 'all';
  const page = parseInt(searchParams.get('page') ?? '1', 10);

  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchQ);

  function setParam(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value); else p.delete(key);
    p.delete('page');
    router.push(`/prompts?${p.toString()}`);
  }

  function setPage(n: number) {
    const p = new URLSearchParams(searchParams.toString());
    p.set('page', String(n));
    router.push(`/prompts?${p.toString()}`);
  }

  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/prompts?limit=500');
      if (res.ok) {
        const data = await res.json() as PromptsResponse | Prompt[];
        const list = Array.isArray(data) ? data : (data.prompts ?? []);
        setPrompts(list);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void loadPrompts(); }, [loadPrompts]);

  // Live search debounce
  useEffect(() => {
    const t = setTimeout(() => {
      const p = new URLSearchParams(searchParams.toString());
      if (search) p.set('q', search); else p.delete('q');
      p.delete('page');
      router.replace(`/prompts?${p.toString()}`);
    }, 300);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let list = filterByDate(prompts, dateRange);
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(p => p.body.toLowerCase().includes(q) || p.id.includes(q));
    }
    return list;
  }, [prompts, searchQ, dateRange]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    filtered.forEach(p => { counts[p.status] = (counts[p.status] ?? 0) + 1; });
    return counts;
  }, [filtered]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>✦ Prompts</h1>
        <span style={{ fontSize: 13, color: '#718096' }}>
          {filtered.length} prompt{filtered.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => void loadPrompts()}
          style={{ marginLeft: 'auto', background: '#2d3748', color: '#a0aec0', border: '1px solid #4a5568', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 13 }}
        >
          Refresh
        </button>
      </div>

      {/* Status chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        {Object.entries(statusCounts).map(([s, count]) => {
          const cfg = statusFromTasks(s);
          return (
            <span key={s} style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.color}40`, borderRadius: 12, padding: '2px 10px', fontSize: 11 }}>
              {cfg.emoji} {cfg.label} {count}
            </span>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          placeholder="Search prompts…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search prompts"
          style={{
            background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568',
            borderRadius: 4, padding: '6px 12px', fontSize: 13, width: 280,
          }}
        />
        <select
          value={dateRange}
          onChange={e => setParam('date', e.target.value)}
          aria-label="Date range"
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '6px 8px', fontSize: 13 }}
        >
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">Last 30 days</option>
          <option value="all">All time</option>
        </select>
        {(searchQ || dateRange !== 'all') && (
          <button
            onClick={() => { setSearch(''); router.push('/prompts'); }}
            style={{ background: '#742a2a', color: '#fed7d7', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer', fontSize: 13 }}
          >
            Clear ×
          </button>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>Loading prompts…</div>
      ) : pageItems.length === 0 ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>
          {prompts.length === 0 ? 'No prompts yet' : 'No prompts match filters'}
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #2d3748' }}>
                  {['Time', 'Prompt', 'Status', 'Via', 'Duration', 'Actions'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#718096', fontWeight: 500, fontSize: 11, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageItems.map(p => {
                  const cfg = statusFromTasks(p.status);
                  return (
                    <tr key={p.id} style={{ borderBottom: '1px solid #1a1f2e' }}>
                      <td style={{ padding: '10px 10px', whiteSpace: 'nowrap', color: '#718096', fontSize: 11, verticalAlign: 'top' }}>
                        <time dateTime={p.receivedAt} title={new Date(p.receivedAt).toLocaleString()}>
                          {relativeTime(p.receivedAt)}
                        </time>
                      </td>
                      <td style={{ padding: '10px 10px', maxWidth: 420, verticalAlign: 'top' }}>
                        <div style={{ color: '#f0f4f8', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                          {p.body}
                        </div>
                        <div style={{ fontSize: 10, color: '#4a5568', fontFamily: 'monospace', marginTop: 2 }}>
                          {p.id}
                        </div>
                      </td>
                      <td style={{ padding: '10px 10px', whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                        <span style={{ background: cfg.bg, color: cfg.color, fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600 }}>
                          {cfg.emoji} {cfg.label}
                        </span>
                      </td>
                      <td style={{ padding: '10px 10px', whiteSpace: 'nowrap', color: '#718096', fontSize: 11, verticalAlign: 'top' }}>
                        {p.receivedVia}
                      </td>
                      <td style={{ padding: '10px 10px', whiteSpace: 'nowrap', color: '#a0aec0', fontSize: 11, verticalAlign: 'top', fontFamily: 'monospace' }}>
                        {p.elapsedMs ? fmt(p.elapsedMs) : '—'}
                      </td>
                      <td style={{ padding: '10px 10px', verticalAlign: 'top' }}>
                        <Link
                          href={`/pipeline?promptId=${p.id}`}
                          style={{
                            fontSize: 11,
                            color: '#63b3ed',
                            textDecoration: 'none',
                            whiteSpace: 'nowrap',
                            border: '1px solid #63b3ed40',
                            borderRadius: 4,
                            padding: '2px 8px',
                          }}
                        >
                          View Pipeline →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16, justifyContent: 'center' }}>
              <button
                onClick={() => setPage(currentPage - 1)}
                disabled={currentPage <= 1}
                style={{
                  background: '#2d3748', color: currentPage <= 1 ? '#4a5568' : '#e2e8f0',
                  border: '1px solid #4a5568', borderRadius: 4, padding: '5px 14px',
                  cursor: currentPage <= 1 ? 'not-allowed' : 'pointer', fontSize: 13,
                }}
              >
                ← Prev
              </button>
              <span style={{ fontSize: 13, color: '#718096' }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                style={{
                  background: '#2d3748', color: currentPage >= totalPages ? '#4a5568' : '#e2e8f0',
                  border: '1px solid #4a5568', borderRadius: 4, padding: '5px 14px',
                  cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer', fontSize: 13,
                }}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PromptsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading prompts…</div>}>
      <PromptsContent />
    </Suspense>
  );
}
