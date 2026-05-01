'use client';
import { useEffect, useState, Suspense, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

interface Notification {
  id: string;
  requirementId: string | null;
  taskId: string | null;
  kind: 'started' | 'progress' | 'completed' | 'blocked';
  message: string;
  channel: 'chat' | 'native' | 'both';
  isRead: boolean;
  readAt: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const KIND_COLORS: Record<string, { bg: string; color: string }> = {
  started: { bg: '#2b6cb0', color: '#e2e8f0' },
  progress: { bg: '#553c9a', color: '#e2e8f0' },
  completed: { bg: '#276749', color: '#e2e8f0' },
  blocked: { bg: '#9b2c2c', color: '#e2e8f0' },
};

const KIND_ICONS: Record<string, string> = {
  started: '▶',
  progress: '⟳',
  completed: '✓',
  blocked: '⛔',
};

function relativeTime(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function NotificationsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const kindFilter = searchParams.get('kind') ?? '';
  const unreadOnly = searchParams.get('unread') === 'true';

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const [clearingRead, setClearingRead] = useState(false);

  const fetchNotifications = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams();
    if (unreadOnly) qs.set('unread_only', 'true');
    fetch(`/api/notifications?${qs.toString()}`)
      .then((r) => r.json())
      .then((data: unknown) => {
        const d = data as { notifications?: Notification[] };
        let items = d.notifications ?? [];
        if (kindFilter) items = items.filter((n) => n.kind === kindFilter);
        setNotifications(items);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [kindFilter, unreadOnly]);

  useEffect(() => {
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(timer);
  }, [fetchNotifications]);

  useEffect(() => {
    fetch('/api/notifications/unread-count')
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { count?: number };
        setUnreadCount(data.count ?? 0);
      })
      .catch(() => {});
  }, [notifications]);

  const markRead = useCallback(
    (id: string) => {
      fetch(`/api/notifications/${id}/read`, { method: 'POST' })
        .then(() => fetchNotifications())
        .catch(() => {});
    },
    [fetchNotifications],
  );

  const markAllRead = useCallback(() => {
    setMarkingAll(true);
    fetch('/api/notifications/read-all', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(() => fetchNotifications())
      .catch(() => {})
      .finally(() => setMarkingAll(false));
  }, [fetchNotifications]);

  const deleteNotification = useCallback(
    (id: string) => {
      fetch(`/api/notifications/${id}`, { method: 'DELETE' })
        .then(() => setNotifications((prev) => prev.filter((n) => n.id !== id)))
        .catch(() => {});
    },
    [],
  );

  const clearRead = useCallback(() => {
    setClearingRead(true);
    fetch('/api/notifications/delete-read', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(() => fetchNotifications())
      .catch(() => {})
      .finally(() => setClearingRead(false));
  }, [fetchNotifications]);

  const setParam = (key: string, value: string | null) => {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/notifications?${p.toString()}`);
  };

  const readCount = notifications.filter((n) => n.isRead).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          🔔 Notifications
        </h1>
        {unreadCount > 0 && (
          <span style={{ background: '#fc8181', color: '#1a202c', borderRadius: 12, padding: '2px 8px', fontSize: 12, fontWeight: 700 }}>
            {unreadCount} unread
          </span>
        )}

        <select
          value={kindFilter}
          onChange={(e) => setParam('kind', e.target.value || null)}
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          aria-label="Filter by kind"
        >
          <option value="">All kinds</option>
          <option value="started">Started</option>
          <option value="progress">Progress</option>
          <option value="completed">Completed</option>
          <option value="blocked">Blocked</option>
        </select>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#a0aec0', cursor: 'pointer' }}>
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setParam('unread', e.target.checked ? 'true' : null)} />
          Unread only
        </label>

        <div style={{ flex: 1 }} />

        <span style={{ fontSize: 13, color: '#718096' }}>{notifications.length} notifications</span>

        {readCount > 0 && (
          <button
            type="button"
            onClick={clearRead}
            disabled={clearingRead}
            style={{ background: '#2d3748', color: '#fc8181', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: clearingRead ? 'not-allowed' : 'pointer', opacity: clearingRead ? 0.6 : 1 }}
          >
            {clearingRead ? 'Clearing…' : `Clear read (${readCount})`}
          </button>
        )}

        {unreadCount > 0 && (
          <button
            type="button"
            onClick={markAllRead}
            disabled={markingAll}
            style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 10px', fontSize: 12, cursor: markingAll ? 'not-allowed' : 'pointer', opacity: markingAll ? 0.6 : 1 }}
          >
            {markingAll ? 'Marking…' : 'Mark all read'}
          </button>
        )}
      </div>

      {loading ? (
        <div style={{ color: '#718096', padding: 16 }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {notifications.map((n) => {
            const kindStyle = KIND_COLORS[n.kind] ?? { bg: '#2d3748', color: '#e2e8f0' };
            return (
              <div
                key={n.id}
                style={{
                  background: n.isRead ? '#161b27' : '#1a1f2e',
                  borderRadius: 6,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  border: `1px solid ${n.isRead ? '#242b3d' : '#2d3748'}`,
                  opacity: n.isRead ? 0.7 : 1,
                }}
              >
                {!n.isRead && (
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fc8181', flexShrink: 0, marginTop: 6 }} aria-label="Unread" />
                )}

                <span style={{ background: kindStyle.bg, color: kindStyle.color, fontSize: 10, padding: '2px 7px', borderRadius: 6, whiteSpace: 'nowrap', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span aria-hidden="true">{KIND_ICONS[n.kind] ?? '•'}</span>
                  {n.kind}
                </span>

                <span style={{ flex: 1, fontSize: 13, color: '#e2e8f0', lineHeight: 1.5 }}>{n.message}</span>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  {n.requirementId && (
                    <a href={`/requirements?id=${n.requirementId}`} style={{ fontSize: 10, color: '#63b3ed', textDecoration: 'none', fontFamily: 'monospace' }}>
                      req/{n.requirementId.slice(0, 8)}
                    </a>
                  )}
                  {n.taskId && (
                    <a href={`/tasks?id=${n.taskId}`} style={{ fontSize: 10, color: '#68d391', textDecoration: 'none', fontFamily: 'monospace' }}>
                      task/{n.taskId.slice(0, 8)}
                    </a>
                  )}
                  <time dateTime={n.createdAt} style={{ fontSize: 10, color: '#4a5568', whiteSpace: 'nowrap' }} title={new Date(n.createdAt).toLocaleString()}>
                    {relativeTime(n.createdAt)}
                  </time>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {!n.isRead && (
                      <button
                        type="button"
                        onClick={() => markRead(n.id)}
                        style={{ background: 'transparent', border: '1px solid #4a5568', color: '#a0aec0', borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}
                        title="Mark as read"
                      >
                        ✓ read
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteNotification(n.id)}
                      style={{ background: 'transparent', border: '1px solid #4a5568', color: '#718096', borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer' }}
                      title="Delete notification"
                      aria-label="Delete notification"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {notifications.length === 0 && (
            <div style={{ color: '#718096', padding: 24, textAlign: 'center' }}>No notifications</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading…</div>}>
      <NotificationsContent />
    </Suspense>
  );
}
