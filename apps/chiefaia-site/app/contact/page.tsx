/**
 * /contact — simple inquiry form. Posts to /api/contact (server-side stub
 * that logs + 200s today; will swap to a real forms endpoint once the
 * operator picks the destination).
 */

import type { Metadata } from 'next';
import { ContactForm } from '../../components/contact-form';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Get in touch with the ChiefAIA team. Sales, partnerships, demos.',
  alternates: { canonical: '/contact' },
};

export const dynamic = 'force-static';

export default function ContactPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Contact
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-foreground">
          Tell us what you&apos;re working on
        </h1>
        <p className="max-w-2xl text-muted-foreground">
          Drop a quick note and we&apos;ll reply within a business day. The form
          posts to our internal inbox today — no third-party trackers.
        </p>
      </header>
      <ContactForm />
    </div>
  );
}
