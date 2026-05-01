'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';

interface NotificationItem {
  id: string;
  requirementId: string | null;
  taskId: string | null;
  kind: 'started' | 'progress' | 'completed' | 'blocked';
  message: string;
  isRead: boolean;
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

function relativeTime(ts: string): string {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [marking, setMarking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchCount = useCallback(() => {
    fetch('/api/notifications/unread-count')
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { count?: number };
        setUnreadCount(data.count ?? 0);
      })
      .catch(() => {});
  }, []);

  const fetchRecent = useCallback(() => {
    setLoading(true);
    fetch('/api/notifications?limit=10')
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { notifications?: NotificationItem[] };
        setItems(data.notifications ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchCount();
    const timer = setInterval(fetchCount, 30_000);
    return () => clearInterval(timer);
  }, [fetchCount]);

  useEffect(() => {
    if (!open) return;
    fetchRecent();
  }, [open, fetchRecent]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  function markRead(id: string) {
    fetch(`/api/notifications/${id}/read`, { method: 'POST' })
      .then(() => {
        setItems((prev) =>
          prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        );
        setUnreadCount((c) => Math.max(0, c - 1));
      })
      .catch(() => {});
  }

  function markAllRead() {
    setMarking(true);
    fetch('/api/notifications/read-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
      .then(() => {
        setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
        setUnreadCount(0);
      })
      .catch(() => {})
      .finally(() => setMarking(false));
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : 'Notifications'}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 6px',
          borderRadius: 6,
          color: '#a0aec0',
          fontSize: 16,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        🔔
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              background: '#fc8181',
              color: '#1a202c',
              borderRadius: '50%',
              minWidth: 14,
              height: 14,
              fontSize: 9,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 2px',
              lineHeight: 1,
            }}
            aria-hidden="true"
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 1000,
            width: 320,
            background: '#1a1f2e',
            border: '1px solid #2d3748',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            overflow: 'hidden',
          }}
          role="dialog"
          aria-label="Recent notifications"
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '10px 14px',
              borderBottom: '1px solid #2d3748',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f0f4f8', flex: 1 }}>
              Notifications
              {unreadCount > 0 && (
                <span
                  style={{
                    marginLeft: 6,
                    background: '#fc8181',
                    color: '#1a202c',
                    borderRadius: 10,
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '1px 5px',
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                disabled={marking}
                style={{
                  background: 'transparent',
                  border: '1px solid #4a5568',
                  color: '#90cdf4',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 11,
                  cursor: marking ? 'not-allowed' : 'pointer',
                  opacity: marking ? 0.6 : 1,
                }}
              >
                {marking ? '...' : 'Mark all read'}
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ color: '#718096', padding: 16, fontSize: 12, textAlign: 'center' }}>
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div style={{ color: '#718096', padding: 24, fontSize: 12, textAlign: 'center' }}>
                No notifications
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '8px 14px',
                    borderBottom: '1px solid #1e2433',
                    background: n.isRead ? 'transparent' : '#1e2a3a',
                    opacity: n.isRead ? 0.65 : 1,
                  }}
                >
                  <span
                    style={{
                      color: KIND_COLORS[n.kind] ?? '#a0aec0',
                      fontSize: 12,
                      marginTop: 1,
                      flexShrink: 0,
                    }}
                    aria-label={n.kind}
                  >
                    {KIND_ICONS[n.kind] ?? '•'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#e2e8f0',
                        lineHeight: 1.4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={n.message}
                    >
                      {n.message}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 3, alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: 9,
                          color: KIND_COLORS[n.kind] ?? '#718096',
                          background: '#2d3748',
                          padding: '1px 4px',
                          borderRadius: 3,
                        }}
                      >
                        {n.kind}
                      </span>
                      <span style={{ fontSize: 10, color: '#4a5568', marginLeft: 'auto' }}>
                        {relativeTime(n.createdAt)} ago
                      </span>
                    </div>
                  </div>
                  {!n.isRead && (
                    <button
                      type="button"
                      onClick={() => markRead(n.id)}
                      title="Mark as read"
                      aria-label="Mark as read"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#4a5568',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: '0 2px',
                        flexShrink: 0,
                      }}
                    >
                      ✓
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div
            style={{
              padding: '8px 14px',
              borderTop: '1px solid #2d3748',
              textAlign: 'center',
            }}
          >
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              style={{
                fontSize: 12,
                color: '#63b3ed',
                textDecoration: 'none',
              }}
            >
              View all notifications →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
