import './globals.css';

/**
 * Root layout for the customer-facing wizard app.
 *
 * Intentionally minimal: no operator sidebar, no breadcrumb. The
 * wizard's own nested layout (`app/wizard/layout.tsx`) renders the
 * 7-step Card + Progress shell on top of this.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" id="favicon" />
        <title>CAIA Wizard</title>
      </head>
      <body
        style={{
          margin: 0,
          background: '#0f1117',
          color: '#f0f4f8',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
