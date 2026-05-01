'use client';

/**
 * Sidebar — accordion-based left navigation (DASH-001).
 *
 * Replaces the inline flat-list `SidebarInner` previously embedded in
 * `app/layout.tsx`. The 27-item flat list was reorganized into six top-level
 * groups (Work / Pipeline / Catalog / Quality / Operations / Settings) per
 * the IA spec at caia/docs/dashboard-url-schema.md.
 *
 * Behaviour:
 *   - Multi-open accordion. Per-group expanded state persists in
 *     localStorage under `nav.expanded` so users keep their preferred
 *     layout.
 *   - The active section auto-expands when its pathname matches.
 *   - Per-leaf unseen badges (existing useUnseenBadges hook) plus a
 *     section-level roll-up shown on the collapsed group header.
 *   - Project filter unchanged — query string `?project=<slug>` still
 *     applied to every link.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useUnseenBadges } from '../../hooks/useUnseenBadges';
import { NavProjectSelector } from '../NavProjectSelector';
import { NotificationBell } from '../NotificationBell';
import { NAV_GROUPS, NAV_LEAVES, kindToTab, groupUnseenCount } from './groups';

const STORAGE_KEY = 'nav.expanded';

function readExpandedFromStorage(): Record<string, boolean> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
    return null;
  } catch {
    return null;
  }
}

function writeExpandedToStorage(state: Record<string, boolean>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore — quota or disabled storage
  }
}

function defaultExpandedState(): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const group of NAV_GROUPS) state[group.id] = group.defaultExpanded;
  return state;
}

function updateFavicon(totalUnseen: number) {
  if (typeof window === 'undefined') return;
  const favicon = document.getElementById('favicon') as HTMLLinkElement | null;
  if (!favicon) return;

  if (totalUnseen > 0) {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 32, 32);
      ctx.fillStyle = '#fc8181';
      ctx.beginPath();
      ctx.arc(26, 6, 7, 0, Math.PI * 2);
      ctx.fill();
      favicon.href = canvas.toDataURL('image/png');
    };
    img.onerror = () => {};
    img.src = '/favicon.ico';
  } else {
    favicon.href = '/favicon.ico';
  }
}

export function Sidebar() {
  const pathname = usePathname();
  const { lastEvent, connected } = useWebSocket('ws://localhost:7776/events');
  const { unseen, increment, markSeen, totalUnseen } = useUnseenBadges();
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  // Expanded state — initialized from localStorage on mount, falls back to
  // defaults. We keep an "initialized" flag so the first paint matches the
  // server (defaults), then we hydrate from storage.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(defaultExpandedState);

  useEffect(() => {
    const fromStorage = readExpandedFromStorage();
    if (fromStorage) {
      setExpanded((prev) => ({ ...prev, ...fromStorage }));
    }
  }, []);

  // Auto-expand the section containing the active route.
  const activeLeaf = useMemo(
    () => NAV_LEAVES.find((leaf) => pathname === leaf.path || pathname.startsWith(leaf.path + '/')),
    [pathname],
  );
  const activeGroupId = useMemo(() => {
    if (!activeLeaf) return null;
    return NAV_GROUPS.find((g) => g.leaves.some((l) => l.tabKey === activeLeaf.tabKey))?.id ?? null;
  }, [activeLeaf]);

  useEffect(() => {
    if (activeGroupId) {
      setExpanded((prev) => (prev[activeGroupId] ? prev : { ...prev, [activeGroupId]: true }));
    }
  }, [activeGroupId]);

  // Persist expanded state.
  useEffect(() => {
    writeExpandedToStorage(expanded);
  }, [expanded]);

  const currentTab = activeLeaf?.tabKey ?? 'timeline';

  // Mark current tab seen when pathname changes.
  useEffect(() => {
    markSeen(currentTab);
  }, [currentTab, markSeen]);

  // Increment unseen when WS event arrives for a non-active tab.
  useEffect(() => {
    if (!lastEvent?.kind) return;
    const tab = kindToTab(lastEvent.kind);
    if (tab !== currentTab) {
      increment(tab);
    }
  }, [lastEvent, currentTab, increment]);

  // Document title + favicon dot.
  useEffect(() => {
    document.title = totalUnseen > 0 ? `Conductor (${totalUnseen})` : 'Conductor';
  }, [totalUnseen]);
  useEffect(() => {
    updateFavicon(totalUnseen);
  }, [totalUnseen]);

  const toggleGroup = useCallback((groupId: string) => {
    setExpanded((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      // Mark all leaves in this group seen when collapsing/expanding.
      const group = NAV_GROUPS.find((g) => g.id === groupId);
      if (group && next[groupId]) {
        // expanding — don't mark seen (user is opening to look)
      } else if (group) {
        // collapsing — leave badges as-is
      }
      return next;
    });
  }, []);

  const linkHref = useCallback(
    (path: string) => (projectFilter ? `${path}?project=${projectFilter}` : path),
    [projectFilter],
  );

  return (
    <nav
      style={{
        width: 220,
        background: '#1a1f2e',
        borderRight: '1px solid #2d3748',
        display: 'flex',
        flexDirection: 'column',
        padding: '16px 0 0',
        overflowY: 'auto',
        flexShrink: 0,
        height: '100vh',
      }}
      aria-label="Main navigation"
    >
      {/* Brand header */}
      <div style={{ padding: '0 16px 16px', borderBottom: '1px solid #2d3748', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#90cdf4' }}>🎼 Conductor</div>
          <NotificationBell />
        </div>
        <div style={{ fontSize: 11, color: connected ? '#68d391' : '#fc8181', marginTop: 4 }}>
          {connected ? '● live' : '○ reconnecting...'}
        </div>
      </div>

      {/* Project filter */}
      <NavProjectSelector value={projectFilter} onChange={setProjectFilter} />

      {/* Accordion groups */}
      {NAV_GROUPS.map((group) => {
        const isOpen = !!expanded[group.id];
        const groupBadge = isOpen ? 0 : groupUnseenCount(group, unseen);
        const regionId = `nav-region-${group.id}`;
        return (
          <div key={group.id} style={{ display: 'flex', flexDirection: 'column' }}>
            <button
              type="button"
              onClick={() => toggleGroup(group.id)}
              aria-expanded={isOpen}
              aria-controls={regionId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#cbd5e0',
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 700,
                textAlign: 'left',
                cursor: 'pointer',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                marginTop: 8,
              }}
            >
              <span style={{ fontSize: 14 }} aria-hidden="true">{group.icon}</span>
              <span style={{ flex: 1 }}>{group.label}</span>
              {groupBadge > 0 && (
                <span
                  style={{
                    background: '#fc8181',
                    color: '#1a202c',
                    borderRadius: '50%',
                    width: 16,
                    height: 16,
                    fontSize: 9,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  aria-hidden="true"
                >
                  {groupBadge > 99 ? '99+' : groupBadge}
                </span>
              )}
              <span
                style={{
                  fontSize: 10,
                  color: '#718096',
                  transform: isOpen ? 'rotate(90deg)' : 'rotate(0)',
                  transition: 'transform 0.15s',
                }}
                aria-hidden="true"
              >
                ▶
              </span>
            </button>
            {isOpen && (
              <ul
                id={regionId}
                role="region"
                aria-label={`${group.label} navigation`}
                style={{ listStyle: 'none', padding: 0, margin: 0 }}
              >
                {group.leaves.map((leaf) => {
                  const isActive =
                    pathname === leaf.path || pathname.startsWith(leaf.path + '/');
                  const count = unseen[leaf.tabKey] ?? 0;
                  return (
                    <li key={leaf.path}>
                      <Link
                        href={linkHref(leaf.path)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '6px 16px 6px 32px',
                          background: isActive ? '#2d3748' : 'transparent',
                          color: isActive ? '#90cdf4' : '#a0aec0',
                          textDecoration: 'none',
                          fontSize: 13,
                          fontWeight: isActive ? 600 : 400,
                          borderLeft: isActive ? '2px solid #63b3ed' : '2px solid transparent',
                          transition: 'all 0.15s',
                        }}
                        aria-label={count > 0 ? `${leaf.label} — ${count} unseen updates` : leaf.label}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        <span style={{ fontSize: 14 }} aria-hidden="true">{leaf.icon}</span>
                        <span style={{ flex: 1 }}>{leaf.label}</span>
                        {count > 0 && (
                          <span
                            style={{
                              background: '#fc8181',
                              color: '#1a202c',
                              borderRadius: '50%',
                              width: 18,
                              height: 18,
                              fontSize: 10,
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                            aria-hidden="true"
                          >
                            {count > 99 ? '99+' : count}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default Sidebar;
