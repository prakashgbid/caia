'use client';
import { useState, useEffect, useCallback, Suspense } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWebSocket } from '../hooks/useWebSocket';
import { useUnseenBadges } from '../hooks/useUnseenBadges';
import { NavProjectSelector } from '../components/NavProjectSelector';
import './globals.css';

const NAV_ITEMS = [
  { path: '/timeline', label: 'Timeline', icon: '🕒', tabKey: 'timeline' },
  { path: '/domains', label: 'Domains', icon: '🏷️', tabKey: 'domains' },
  { path: '/projects', label: 'Projects', icon: '📁', tabKey: 'projects' },
  { path: '/tasks', label: 'Tasks', icon: '📋', tabKey: 'tasks' },
  { path: '/task-runs', label: 'Task Runs', icon: '📡', tabKey: 'task_runs' },
  { path: '/requirements', label: 'Requirements', icon: '📝', tabKey: 'requirements' },
  { path: '/blockers', label: 'Blockers', icon: '🚨', tabKey: 'blockers' },
  { path: '/questions', label: 'Questions', icon: '❓', tabKey: 'questions' },
  { path: '/adrs', label: 'ADRs', icon: '📜', tabKey: 'adrs' },
  { path: '/features', label: 'Features', icon: '🎯', tabKey: 'features' },
  { path: '/suggestions', label: 'Suggestions', icon: '💡', tabKey: 'suggestions' },
  { path: '/audit', label: 'Audit', icon: '🔍', tabKey: 'audit' },
  { path: '/tests', label: 'Tests', icon: '🧪', tabKey: 'tests' },
  { path: '/metrics', label: 'Metrics', icon: '📊', tabKey: 'metrics' },
  { path: '/settings', label: 'Settings', icon: '⚙️', tabKey: 'settings' },
] as const;

// Map WS event kind prefix → tab key
function kindToTab(kind: string): string {
  if (kind.startsWith('task_run.')) return 'task_runs';
  if (kind.startsWith('behavior_test.')) return 'tests';
  if (kind.startsWith('task.') || kind.startsWith('task_')) return 'tasks';
  if (kind.startsWith('requirement.')) return 'requirements';
  if (kind.startsWith('blocker.')) return 'blockers';
  if (kind.startsWith('question.')) return 'questions';
  if (kind.startsWith('adr.')) return 'adrs';
  if (kind.startsWith('feature.')) return 'features';
  if (kind.startsWith('suggestion.')) return 'suggestions';
  if (kind.startsWith('project.')) return 'projects';
  if (kind.startsWith('timeline.')) return 'timeline';
  if (kind.startsWith('audit.')) return 'audit';
  if (kind.startsWith('domain.') || kind.startsWith('entity.tagged') || kind.startsWith('entity.untagged')) return 'domains';
  return 'timeline';
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
    img.onerror = () => {}; // ignore missing favicon
    img.src = '/favicon.ico';
  } else {
    favicon.href = '/favicon.ico';
  }
}

function SidebarInner() {
  const pathname = usePathname();
  const { lastEvent, connected } = useWebSocket('ws://localhost:7776/events');
  const { unseen, increment, markSeen, totalUnseen } = useUnseenBadges();
  const [projectFilter, setProjectFilter] = useState<string | null>(null);

  // Current active tab key
  const currentTab = NAV_ITEMS.find(n => pathname.startsWith(n.path))?.tabKey ?? 'timeline';

  // Mark current tab seen when pathname changes
  useEffect(() => {
    markSeen(currentTab);
  }, [currentTab, markSeen]);

  // Increment unseen when WS event arrives for a non-active tab
  useEffect(() => {
    if (!lastEvent?.kind) return;
    const tab = kindToTab(lastEvent.kind);
    if (tab !== currentTab) {
      increment(tab);
    }
  }, [lastEvent, currentTab, increment]);

  // Update document title
  useEffect(() => {
    document.title = totalUnseen > 0 ? `Conductor (${totalUnseen})` : 'Conductor';
  }, [totalUnseen]);

  // Update favicon dot
  useEffect(() => {
    updateFavicon(totalUnseen);
  }, [totalUnseen]);

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
        <div style={{ fontSize: 18, fontWeight: 700, color: '#90cdf4' }}>🎼 Conductor</div>
        <div style={{ fontSize: 11, color: connected ? '#68d391' : '#fc8181', marginTop: 4 }}>
          {connected ? '● live' : '○ reconnecting...'}
        </div>
      </div>

      {/* Project filter */}
      <NavProjectSelector value={projectFilter} onChange={setProjectFilter} />

      {/* Nav links */}
      {NAV_ITEMS.map(item => {
        const isActive = pathname === item.path || pathname.startsWith(item.path + '/');
        const count = unseen[item.tabKey] ?? 0;
        const href = projectFilter
          ? `${item.path}?project=${projectFilter}`
          : item.path;

        return (
          <Link
            key={item.path}
            href={href}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              background: isActive ? '#2d3748' : 'transparent',
              color: isActive ? '#90cdf4' : '#a0aec0',
              textDecoration: 'none',
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? '2px solid #63b3ed' : '2px solid transparent',
              transition: 'all 0.15s',
            }}
            aria-label={count > 0 ? `${item.label} — ${count} unseen updates` : item.label}
            aria-current={isActive ? 'page' : undefined}
          >
            <span style={{ fontSize: 16 }} aria-hidden="true">{item.icon}</span>
            <span style={{ flex: 1 }}>{item.label}</span>
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
        );
      })}
    </nav>
  );
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" id="favicon" />
        <title>Conductor</title>
      </head>
      <body
        style={{
          margin: 0,
          background: '#0f1117',
          color: '#f0f4f8',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          height: '100vh',
          overflow: 'hidden',
        }}
      >
        <Suspense fallback={
          <nav style={{ width: 220, background: '#1a1f2e', borderRight: '1px solid #2d3748', flexShrink: 0 }} />
        }>
          <SidebarInner />
        </Suspense>

        {/* Main content area */}
        <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {children}
        </main>
      </body>
    </html>
  );
}
