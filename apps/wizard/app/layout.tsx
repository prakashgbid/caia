import './globals.css';

/**
 * Root layout for the wizard app.
 *
 * - Default theme = dark (matches AI product aesthetic; toggleable in the
 *   WizardShell header).
 * - Inter font served via Google Fonts import in globals.css.
 * - Body has no inline styles; every color / spacing lives in Tailwind
 *   utilities driven by @caia/ui's design tokens.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" id="favicon" />
        <title>CAIA — Build software with AI</title>
        <meta name="description" content="CAIA turns your idea into a shipped app. No code, no infrastructure hassle — just describe what you want and CAIA builds it for you." />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
