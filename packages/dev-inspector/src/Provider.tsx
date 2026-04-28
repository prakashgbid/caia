'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useHover } from './useHover';
import { Overlay } from './Overlay';
import { assignAllIds, startObserver, stopObserver, clearAllIds } from './id/assignIds';
import { registerKeybind } from './keybind';
import { registerGlobalApi, unregisterGlobalApi } from './api';
import { destroyToast } from './copy';

const STORAGE_KEY = 'dev-inspector:active';

interface ChipProps {
  active: boolean;
  onToggle: () => void;
}

function Chip({ active, onToggle }: ChipProps) {
  return (
    <button
      onClick={onToggle}
      title="Dev Inspector (Alt+I)"
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 2147483647,
        background: active ? '#DC2626' : 'rgba(0,0,0,0.75)',
        color: '#fff',
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: 6,
        fontFamily: 'Menlo, Consolas, monospace',
        fontSize: 10,
        padding: '3px 8px',
        cursor: 'pointer',
        lineHeight: '16px',
        userSelect: 'none',
        backdropFilter: 'blur(4px)',
      }}
    >
      {active ? '◉ inspect' : '○ inspect'}
    </button>
  );
}

function InspectorCore() {
  const hasRun = useRef(false);

  const readStorage = () => {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  };

  const writeStorage = (val: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, String(val));
    } catch {
      // ignore
    }
  };

  const [active, setActive] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.get('inspect') === '1') return true;
    return readStorage();
  });

  const toggle = useCallback((on?: boolean) => {
    setActive(prev => {
      const next = on !== undefined ? on : !prev;
      writeStorage(next);
      return next;
    });
  }, []);

  // Assign IDs when activated
  useEffect(() => {
    if (active) {
      if (!hasRun.current) {
        // Slight delay to let React finish first paint
        const t = setTimeout(() => {
          assignAllIds();
          hasRun.current = true;
        }, 50);
        return () => clearTimeout(t);
      } else {
        assignAllIds();
      }
      startObserver();
    } else {
      stopObserver();
    }
    return undefined;
  }, [active]);

  // Keybind
  useEffect(() => {
    return registerKeybind(toggle);
  }, [toggle]);

  // Global API
  useEffect(() => {
    registerGlobalApi(toggle);
    return () => {
      unregisterGlobalApi();
      stopObserver();
      clearAllIds();
      destroyToast();
    };
  }, [toggle]);

  const hoverTarget = useHover(active);

  return (
    <>
      <Chip active={active} onToggle={toggle} />
      <Overlay target={hoverTarget} />
    </>
  );
}

export interface DevInspectorProviderProps {
  children: React.ReactNode;
}

export function DevInspectorProvider({ children }: DevInspectorProviderProps) {
  if (process.env.NODE_ENV !== 'development') {
    return <>{children}</>;
  }

  return (
    <>
      {children}
      <InspectorCore />
    </>
  );
}
