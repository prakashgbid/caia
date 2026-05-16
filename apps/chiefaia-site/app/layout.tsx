import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CAIA — The Chief AI Architect, automated.',
  description:
    'CAIA is an AI-first development platform — autonomous chains, local-first models, and a multi-agent ecosystem that ships code while you sleep.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
