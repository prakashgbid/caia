'use client';
import { Suspense } from 'react';
import { Sidebar } from '../components/nav/Sidebar';
import { Breadcrumb } from '../components/Breadcrumb';
import { AgentActivityRail } from '../components/agents/AgentActivityRail';
import './globals.css';

/**
 * Root layout — DASH-001 (nav restructure) + DASH-003 (breadcrumb)
 * + DASH-005 (agent activity rail).
 *
 * Three-column shell: left nav (220px) | main content | right rail (280px,
 * collapsible to 40px). The breadcrumb renders at the top of main on every
 * drill-down page; section landings and the root self-hide.
 */
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
        <Suspense
          fallback={
            <nav
              style={{
                width: 220,
                background: '#1a1f2e',
                borderRight: '1px solid #2d3748',
                flexShrink: 0,
              }}
            />
          }
        >
          <Sidebar />
        </Suspense>

        {/* Main content area */}
        <main style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          <Suspense fallback={null}>
            <Breadcrumb />
          </Suspense>
          {children}
        </main>

        {/* Right rail — agent activity (DASH-005) */}
        <Suspense fallback={null}>
          <AgentActivityRail />
        </Suspense>
      </body>
    </html>
  );
}
