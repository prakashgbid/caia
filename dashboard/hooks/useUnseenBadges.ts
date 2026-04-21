'use client';
import { useState, useEffect, useCallback } from 'react';

const COUNT_PREFIX = 'conductor.unseenCount.';
const STORAGE_PREFIX = 'conductor.lastSeen.';

export function useUnseenBadges() {
  const [unseen, setUnseen] = useState<Record<string, number>>({});

  // Load initial counts from localStorage
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const initial: Record<string, number> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(COUNT_PREFIX)) {
        const tab = key.slice(COUNT_PREFIX.length);
        const val = parseInt(localStorage.getItem(key) ?? '0', 10);
        if (!isNaN(val) && val > 0) {
          initial[tab] = val;
        }
      }
    }
    setUnseen(initial);
  }, []);

  const increment = useCallback((tab: string) => {
    setUnseen(prev => {
      const next = { ...prev, [tab]: (prev[tab] ?? 0) + 1 };
      if (typeof window !== 'undefined') {
        localStorage.setItem(COUNT_PREFIX + tab, String(next[tab]));
      }
      return next;
    });
  }, []);

  const markSeen = useCallback((tab: string) => {
    setUnseen(prev => {
      if (!prev[tab]) return prev;
      const next = { ...prev };
      delete next[tab];
      if (typeof window !== 'undefined') {
        localStorage.removeItem(COUNT_PREFIX + tab);
        localStorage.setItem(STORAGE_PREFIX + tab, new Date().toISOString());
      }
      return next;
    });
  }, []);

  const totalUnseen = Object.values(unseen).reduce((a, b) => a + b, 0);

  return { unseen, increment, markSeen, totalUnseen };
}
