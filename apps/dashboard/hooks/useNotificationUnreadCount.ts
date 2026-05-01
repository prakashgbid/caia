'use client';

import { useEffect, useState, useCallback } from 'react';

const POLL_INTERVAL = 30_000;

export function useNotificationUnreadCount() {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    fetch('/api/notifications/unread-count')
      .then((r) => r.json())
      .then((d: unknown) => {
        const data = d as { count?: number };
        setCount(data.count ?? 0);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);

  return { count, refresh };
}
