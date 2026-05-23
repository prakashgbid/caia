import type { ReactNode } from 'react';

export const metadata = {
  title: 'CAIA — Onboarding',
  description: 'Connect every tool CAIA will use to ship your product',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          margin: 0,
          background: '#f6f7f9',
          color: '#0f172a',
        }}
      >
        {children}
      </body>
    </html>
  );
}
