'use client';

import { useEffect, useState, useCallback } from 'react';

export interface Notification {
  id: string;
  requirementId: string | null;
  taskId: string | null;
  kind: 'started' | 'progress' | 'completed' | 'blocked';
  message: string;
  channel: string;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

const KIND_COLORS: Record<string, string> = {
  started: '#63b3ed',
  progress: '#ecc94b',
  completed: '#68d391',
  blocked: '#fc8181',
};

const KIND_ICONS: Record<string, string> = {
  started: '▶',
  progress: '⏳',
  completed: '✓',
  blocked: '⛔',
};

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  requirementId?: string;
  taskId?: string;
  limit?: number;
  compact?: boolean;
}

export function NotificationsPanel({ requirementId, taskId, limit = 50, compact = false }: Props) {
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (requirementId) p.set('requirement_id', requirementId);
    if (taskId) p.set('task_id', taskId);
    if (unreadOnly) p.set('unread_only', 'true');
    p.set('limit', String(limit));

    setLoading(true);
    fetch(`/api/notifications?${p.toString()}`)
      .then(r => r.json())
      .then((data: unknown) => {
        const d = data as { notifications?: Notification[] };
        setItems(Array.isArray(d.notifications) ? d.notifications : []);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [requirementId, taskId, unreadOnly, limit]);

  useEffect(() => {
    load();
  }, [load]);

  function markRead(id: string) {
    fetch(`/api/notifications/${id}/read`, { method: 'POST' })
      .then(() => {
        setItems(prev =>
          prev.map(n => (n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)),
        );
      })
      .catch(() => {});
  }

  function markAllRead() {
    setMarkingAll(true);
    const body: Record<string, string> = {};
    if (requirementId) body['requirement_id'] = requirementId;
    if (taskId) body['task_id'] = taskId;
    fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(() => {
        setItems(prev => prev.map(n => ({ ...n, isRead: true, readAt: new Date().toISOString() })));
      })
      .catch(() => {})
      .finally(() => setMarkingAll(false));
  }

  const unreadCount = items.filter(n => !n.isRead).length;

  return (
    <div style={{ background: '#1a202c', borderRadius: 8, padding: compact ? 12 : 16 }}>
      {!compact && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f7fafc', flex: 1 }}>
            🔔 Notifications
            {unreadCount > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  background: '#fc8181',
                  color: '#1a202c',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '1px 6px',
                }}
              >
                {unreadCount}
              </span>
            )}
          </h2>
          <label style={{ fontSize: 12, color: '#a0aec0', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={e => setUnreadOnly(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Unread only
          </label>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              disabled={markingAll}
              style={{
                background: '#2d3748',
                color: '#90cdf4',
                border: '1px solid #4a5568',
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              {markingAll ? 'Marking...' : 'Mark all read'}
            </button>
          )}
          <button
            type="button"
            onClick={load}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#718096',
              cursor: 'pointer',
              fontSize: 14,
            }}
            aria-label="Refresh notifications"
          >
            ↻
          </button>
        </div>
      )}

      <div
        style={{
          height: compact ? 200 : 420,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {loading ? (
          <div style={{ color: '#718096', padding: 16, textAlign: 'center', fontSize: 13 }}>Loading...</div>
        ) : items.length === 0 ? (
          <div style={{ color: '#718096', padding: 24, textAlign: 'center', fontSize: 13 }}>
            No notifications
          </div>
        ) : (
          items.map(n => (
            <div
              key={n.id}
              style={{
                background: n.isRead ? '#1a1f2e' : '#1e2a3a',
                borderRadius: 6,
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                border: `1px solid ${n.isRead ? '#2d3748' : '#2b4c7e'}`,
                opacity: n.isRead ? 0.7 : 1,
              }}
            >
              <span
                style={{
                  color: KIND_COLORS[n.kind] ?? '#a0aec0',
                  fontSize: 14,
                  marginTop: 1,
                  flexShrink: 0,
                }}
                aria-label={n.kind}
              >
                {KIND_ICONS[n.kind] ?? '•'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.4 }}>{n.message}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 10,
                      color: KIND_COLORS[n.kind] ?? '#718096',
                      background: '#2d3748',
                      padding: '1px 5px',
                      borderRadius: 4,
                    }}
                  >
                    {n.kind}
                  </span>
                  {n.taskId && (
                    <span style={{ fontSize: 10, color: '#718096' }}>task:{n.taskId.slice(-8)}</span>
                  )}
                  {n.requirementId && (
                    <span style={{ fontSize: 10, color: '#718096' }}>req:{n.requirementId.slice(-8)}</span>
                  )}
                  <span style={{ fontSize: 10, color: '#4a5568', marginLeft: 'auto' }}>
                    {formatRelative(n.createdAt)}
                  </span>
                </div>
              </div>
              {!n.isRead && (
                <button
                  type="button"
                  onClick={() => markRead(n.id)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#4a5568',
                    cursor: 'pointer',
                    fontSize: 11,
                    flexShrink: 0,
                    padding: '2px 4px',
                  }}
                  aria-label="Mark as read"
                  title="Mark as read"
                >
                  ✓
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
