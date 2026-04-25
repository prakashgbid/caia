import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

const BASE_URL = 'https://{{DOMAIN}}';

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: {
    default: '{{SITE_NAME}}',
    template: `%s · {{SITE_NAME}}`,
  },
  description: '{{SITE_NAME}} — replace this description.',
  applicationName: '{{SITE_NAME}}',
  authors: [{ name: '{{SITE_NAME}}' }],
  alternates: { canonical: BASE_URL },
  openGraph: {
    type: 'website',
    siteName: '{{SITE_NAME}}',
    title: '{{SITE_NAME}}',
    url: BASE_URL,
  },
  robots: { index: true, follow: true },
  icons: [{ rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml' }],
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Header />
        <main id="main-content">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
