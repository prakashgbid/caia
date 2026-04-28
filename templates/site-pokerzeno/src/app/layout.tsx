import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    template: '%s | SITE_NAME',
    default: 'SITE_NAME',
  },
  description: 'SITE_DESCRIPTION',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://example.com'),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <a href="#main-content" className="skip-to-content sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 z-50 bg-white text-black px-4 py-2 rounded">
          Skip to main content
        </a>
        <main id="main-content">
          {children}
        </main>
        {/* ConsentBanner: wire @pokerzeno/analytics when available */}
        {/* DevInspector: wire @pokerzeno/dev-inspector when available */}
      </body>
    </html>
  );
}
