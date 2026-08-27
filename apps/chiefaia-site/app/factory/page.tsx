/**
 * /factory — live CAIA factory status page.
 *
 * Operator-requested (2026-08-25) surface for hourly/daily visibility
 * into what the CAIA factory is producing. Renders on every request
 * (no cache) so the operator can hit this URL any time and see current
 * state without page cache getting in the way.
 *
 * Data sources (all read-only, server-side):
 *   - Recent merged PRs — GitHub Search API (no auth needed for public)
 *   - Sprint status — hardcoded for now; will wire to Jira in a
 *     follow-up when the read-only Jira REST bridge is stable.
 *   - Service health — chiefaia-site + chiefaia-wizard local endpoints
 */

import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Factory Live · ChiefAIA",
  description: "Live CAIA factory status — recent PRs, sprint progress, service health.",
  robots: { index: false, follow: false },
};

interface PullRequest {
  number: number;
  title: string;
  html_url: string;
  merged_at: string | null;
  user: { login: string };
}

async function fetchRecentPRs(): Promise<PullRequest[]> {
  try {
    const r = await fetch(
      "https://api.github.com/repos/prakashgbid/caia/pulls?state=closed&sort=updated&direction=desc&per_page=10",
      { next: { revalidate: 60 } }
    );
    if (!r.ok) return [];
    const prs = (await r.json()) as PullRequest[];
    return prs.filter((p) => p.merged_at).slice(0, 8);
  } catch {
    return [];
  }
}

async function checkService(url: string): Promise<"up" | "down"> {
  try {
    const r = await fetch(url, { method: "HEAD", next: { revalidate: 30 } });
    return r.ok ? "up" : "down";
  } catch {
    return "down";
  }
}

const SPRINTS = [
  {
    name: "Sprint 0 — Startup Discovery & Definition",
    status: "shipped",
    detail: "7-epic dossier (Market · Vision · Business Model · Financials · Investor · Moat · Team) — published in Confluence. Wizard walk-through live at dashboard.chiefaia.com.",
  },
  {
    name: "Sprint 1 — Business Modeling",
    status: "shipped",
    detail: "12 epics of business-model refinement docs — Confluence.",
  },
  {
    name: "Sprint 2 — Architecture Re-tweak",
    status: "shipped",
    detail: "9 ratified ADRs (CAIA-006 through CAIA-014) — tenant isolation, per-app dedicated infra, control/data plane split, auth flow.",
  },
  {
    name: "Sprint 3 — First Execution",
    status: "in-progress",
    detail: "chiefaia.com + dashboard.chiefaia.com live, wizard walk-through public. Real backend integration in progress.",
  },
  {
    name: "Sprint 4 — Infrastructure Architecture",
    status: "shipped",
    detail: "Per-app dedicated infrastructure design ratified. Incus install + tenant-0 provisioning deferred.",
  },
];

export default async function FactoryPage() {
  const [prs, siteHealth, wizardHealth] = await Promise.all([
    fetchRecentPRs(),
    checkService("http://localhost:7878"),
    checkService("http://localhost:7788/wizard/onboarding"),
  ]);

  return (
    <div className="space-y-10">
      <section className="space-y-3 pt-4">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">Live · updated on every request</p>
        <h1 className="text-3xl font-semibold sm:text-4xl">CAIA factory status</h1>
        <p className="max-w-2xl text-muted-foreground">
          What the factory is producing right now. Recent merges, sprint progress, live service health.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Live services</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <ServiceCard name="chiefaia.com (marketing)" status={siteHealth} url="https://chiefaia.com" />
          <ServiceCard name="dashboard.chiefaia.com (wizard)" status={wizardHealth} url="https://dashboard.chiefaia.com/wizard/onboarding" />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Sprints 0–4</h2>
        <ol className="space-y-3">
          {SPRINTS.map((s, i) => (
            <li key={i} className="rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{s.name}</span>
                <StatusPill status={s.status} />
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{s.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Recent merged PRs (prakashgbid/caia)</h2>
        {prs.length === 0 ? (
          <p className="text-sm text-muted-foreground">GitHub API not reachable from origin (or rate-limited). Try again shortly.</p>
        ) : (
          <ul className="space-y-2">
            {prs.map((p) => (
              <li key={p.number} className="rounded border border-border p-3 text-sm">
                <a href={p.html_url} className="font-medium hover:underline">#{p.number} · {p.title}</a>
                <div className="mt-1 text-xs text-muted-foreground">by {p.user.login} · merged {p.merged_at ? new Date(p.merged_at).toLocaleString() : ""}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="text-xs text-muted-foreground">
        This page renders server-side on every request. No client-side auth required. Refresh to pull the latest state.
      </section>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === "shipped" ? "bg-green-800 text-green-100" : status === "in-progress" ? "bg-blue-800 text-blue-100" : "bg-neutral-800 text-neutral-100";
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${color}`}>{status}</span>;
}

function ServiceCard({ name, status, url }: { name: string; status: "up" | "down"; url: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <a href={url} className="font-medium hover:underline">{name}</a>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${status === "up" ? "bg-green-800 text-green-100" : "bg-red-800 text-red-100"}`}>{status.toUpperCase()}</span>
      </div>
    </div>
  );
}
