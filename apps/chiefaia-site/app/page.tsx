// TODO: Promote apps/website-mockups/home.html once operator confirms final mockup.
// Until then this is an intentional placeholder so the deploy pipeline can ship
// the site end-to-end (DNS, SSL, CI) before content is finalized.
export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-12 text-center">
      <h1 className="text-4xl font-semibold text-chalk-50 mb-4">chiefaia.com</h1>
      <p className="text-chalk-400 max-w-xl">
        The Chief AI Architect — coming soon. This scaffold exists so the deploy
        plumbing (DNS, SSL, CI) can be wired up while final content is being
        approved. See <code className="text-brand-400">apps/website-mockups/home.html</code>.
      </p>
    </main>
  );
}
