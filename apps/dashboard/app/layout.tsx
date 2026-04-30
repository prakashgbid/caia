'use client';
import { Suspense } from 'react';
import { Sidebar } from '../components/nav/Sidebar';
import { Breadcrumb } from '../components/Breadcrumb';
import './globals.css';

/**
 * Root layout — DASH-001 (nav restructure) + DASH-003 (breadcrumb).
 *
 * The 27-item flat sidebar previously inlined here was extracted into
 * `components/nav/Sidebar.tsx` as an accordion-grouped component. The
 * breadcrumb (`components/Breadcrumb.tsx`) renders at the top of the
 * main content area on every page; it self-hides on section landings
 * and the root.
 *
 * URLs do not change in this layout — only the structure does. Route
 * migration to the canonical `/section/resource` schema landed in PR2
 * (`feat/dash-002-url-schema-redirect`).
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
      </body>
    </html>
  );
}
