// TODO: Promote apps/website-mockups/dashboard-preview.html once operator confirms.
// NOTE: spec called for a route group "(dashboard-preview)", but in Next.js App
// Router route groups don't add URL segments — that would collide with the
// home page. Using a regular segment `/dashboard-preview` instead.
export default function DashboardPreviewPage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-12 text-center">
      <h1 className="text-3xl font-semibold text-chalk-50 mb-4">Dashboard Preview</h1>
      <p className="text-chalk-400">Placeholder. Source: apps/website-mockups/dashboard-preview.html</p>
    </main>
  );
}
