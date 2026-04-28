'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { registerKeybind } from './keybind';
import { useConsole } from './hooks/useConsole';
import { useNetwork } from './hooks/useNetwork';
import { useVitals } from './hooks/useVitals';
import { useDraggable } from './hooks/useDraggable';
import { AccessibilityTab } from './tabs/AccessibilityTab';
import { IntegrityTab } from './tabs/IntegrityTab';
import { ConsoleTab } from './tabs/ConsoleTab';
import { NetworkTab } from './tabs/NetworkTab';
import { PerformanceTab } from './tabs/PerformanceTab';
import { startBridge, stopBridge } from './mcp/bridge';

type TabId = 'accessibility' | 'integrity' | 'console' | 'network' | 'performance';

const TABS: { id: TabId; label: string }[] = [
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'integrity', label: 'Integrity' },
  { id: 'console', label: 'Console' },
  { id: 'network', label: 'Network' },
  { id: 'performance', label: 'Performance' },
];

const PANEL_WIDTH = 480;
const PANEL_HEIGHT = 400;

function getInitialPosition() {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return {
    x: window.innerWidth - PANEL_WIDTH - 16,
    y: window.innerHeight - PANEL_HEIGHT - 16,
  };
}

export default function Panel() {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('accessibility');
  const [height, setHeight] = useState(PANEL_HEIGHT);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{ startY: number; startH: number } | null>(null);

  const { entries: consoleEntries, clear: clearConsole } = useConsole();
  const { entries: networkEntries, clear: clearNetwork } = useNetwork();
  const vitals = useVitals();

  const { setElement, onMouseDown: onTitleMouseDown } = useDraggable(getInitialPosition());

  const setPanelRef = useCallback((el: HTMLDivElement | null) => {
    panelRef.current = el;
    setElement(el);
  }, [setElement]);

  // Keybind toggle
  useEffect(() => {
    return registerKeybind(() => setOpen(prev => !prev));
  }, []);

  // MCP bridge
  useEffect(() => {
    if (!open) return;

    startBridge(() => ({
      open,
      activeTab,
      violations: [],
      consoleEntries,
      networkEntries,
      vitals,
    }));

    return () => stopBridge();
  }, [open, activeTab, consoleEntries, networkEntries, vitals]);

  // Resize handling
  useEffect(() => {
    function onMouseMove(e: MouseEvent): void {
      if (!resizeRef.current) return;
      const dy = e.clientY - resizeRef.current.startY;
      const newH = Math.max(200, resizeRef.current.startH + dy);
      setHeight(newH);
    }

    function onMouseUp(): void {
      resizeRef.current = null;
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  function onResizeMouseDown(e: React.MouseEvent): void {
    resizeRef.current = { startY: e.clientY, startH: height };
    e.preventDefault();
  }

  if (!open) return null;

  function tabStyle(active: boolean): React.CSSProperties {
    return {
      padding: '7px 12px',
      cursor: 'pointer',
      fontSize: 11,
      fontWeight: 500,
      color: active ? '#f1f5f9' : '#475569',
      background: 'transparent',
      border: 'none',
      borderBottom: active ? '2px solid #3b82f6' : '2px solid transparent',
      whiteSpace: 'nowrap',
      transition: 'color 0.15s',
    };
  }

  const styles: Record<string, React.CSSProperties> = {
    panel: {
      position: 'fixed',
      width: PANEL_WIDTH,
      height,
      background: 'rgba(15, 23, 42, 0.97)',
      backdropFilter: 'blur(8px)',
      border: '1px solid #334155',
      borderRadius: 10,
      zIndex: 2147483600,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Menlo, Consolas, "Courier New", monospace',
      fontSize: 12,
      color: '#f1f5f9',
      boxShadow: '0 25px 50px rgba(0,0,0,0.8)',
      overflow: 'hidden',
    },
    titleBar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '8px 12px',
      borderBottom: '1px solid #1e293b',
      background: 'rgba(30, 41, 59, 0.8)',
      cursor: 'grab',
      userSelect: 'none',
      flexShrink: 0,
    },
    title: { fontWeight: 700, fontSize: 12, color: '#94a3b8', letterSpacing: '0.05em' },
    closeBtn: {
      background: 'transparent',
      border: 'none',
      color: '#64748b',
      cursor: 'pointer',
      fontSize: 16,
      lineHeight: 1,
      padding: '2px 4px',
      borderRadius: 4,
    },
    tabBar: {
      display: 'flex',
      borderBottom: '1px solid #1e293b',
      background: 'rgba(15, 23, 42, 0.6)',
      flexShrink: 0,
      overflowX: 'auto',
    },
    content: {
      flex: 1,
      overflowY: 'auto',
      padding: 12,
    },
    resizeHandle: {
      height: 6,
      cursor: 'ns-resize',
      background: 'transparent',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    resizeDot: {
      width: 32,
      height: 2,
      background: '#334155',
      borderRadius: 1,
    },
  };

  return (
    <div
      ref={setPanelRef}
      role="dialog"
      aria-label="Dev Inspector"
      aria-modal="false"
      style={styles.panel}
      data-testid="dev-inspector-panel"
    >
      {/* Title bar (draggable) */}
      <div style={styles.titleBar} onMouseDown={onTitleMouseDown}>
        <span style={styles.title}>DEV INSPECTOR</span>
        <button
          style={styles.closeBtn}
          aria-label="Close Dev Inspector"
          onClick={() => setOpen(false)}
          data-testid="close-btn"
        >
          ×
        </button>
      </div>

      {/* Tab bar */}
      <div style={styles.tabBar} role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            style={tabStyle(activeTab === tab.id)}
            onClick={() => setActiveTab(tab.id)}
            data-testid={`tab-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={styles.content} role="tabpanel" data-testid="tab-panel">
        {activeTab === 'accessibility' && <AccessibilityTab />}
        {activeTab === 'integrity' && <IntegrityTab />}
        {activeTab === 'console' && (
          <ConsoleTab entries={consoleEntries} onClear={clearConsole} />
        )}
        {activeTab === 'network' && (
          <NetworkTab entries={networkEntries} onClear={clearNetwork} />
        )}
        {activeTab === 'performance' && <PerformanceTab vitals={vitals} />}
      </div>

      {/* Resize handle */}
      <div style={styles.resizeHandle} onMouseDown={onResizeMouseDown}>
        <div style={styles.resizeDot} />
      </div>
    </div>
  );
}
