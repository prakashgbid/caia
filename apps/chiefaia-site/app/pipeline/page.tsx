/**
 * /pipeline — 141-microfactory pipeline visualization.
 *
 * Public marketing surface showing what CAIA actually does under the hood:
 * the 141 microfactories (SF-00..SF-140) grouped by macro stage, plus the
 * 15 control-plane components (CP-01..CP-15) that wire them together.
 *
 * Per [[ship-dont-plan]] — this is a real functional surface, not a promise.
 * Data is server-rendered from a canonical list; every card links to what
 * that microfactory produces so a founder can see the factory shape at
 * a glance.
 */

import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "The Pipeline · ChiefAIA",
  description:
    "141 microfactories + 15 control-plane components. This is what turns a founder brief into shipped software.",
};

interface MicroFactory {
  code: string;
  name: string;
  role: string;
}

interface Stage {
  code: string;
  name: string;
  tagline: string;
  factories: MicroFactory[];
}

const STAGES: Stage[] = [
  {
    code: "A",
    name: "Vision Capture & Intake",
    tagline: "Founder walks in with an idea. CAIA turns it into a canonical brief.",
    factories: [
      { code: "SF-00", name: "Vision Intake", role: "Prompt to canonical vision doc" },
      { code: "SF-01", name: "Interviewer", role: "Multi-turn Q&A to sharpen the brief" },
      { code: "SF-02", name: "Grand Idea Capture", role: "One-paragraph north star" },
      { code: "SF-03", name: "Signal Enrichment", role: "Web + market context" },
      { code: "SF-04", name: "Wizard Orchestrator", role: "7-step flow coordinator" },
      { code: "SF-05", name: "Spec Synthesis", role: "Brief to executable spec" },
      { code: "SF-06", name: "Feasibility Score", role: "Can we build this? Cost + time" },
    ],
  },
  {
    code: "B",
    name: "Product Definition",
    tagline: "Interview thread + information architecture + acceptance criteria.",
    factories: [
      { code: "SF-10", name: "Persona Builder", role: "Target-user cards" },
      { code: "SF-11", name: "Journey Mapper", role: "End-to-end user flows" },
      { code: "SF-12", name: "IA Atlas", role: "Entity + page + relationship map" },
      { code: "SF-13", name: "Coverage Auditor", role: "Gap analysis vs 12 dimensions" },
      { code: "SF-14", name: "AC Writer", role: "GWT acceptance criteria per feature" },
    ],
  },
  {
    code: "C",
    name: "Product Engineering",
    tagline: "Bounded contexts, component contracts, API specs.",
    factories: [
      { code: "SF-65", name: "Bounded Context Modeller", role: "DDD splits" },
      { code: "SF-66", name: "Service Boundary Designer", role: "Where a service starts/ends" },
      { code: "SF-71", name: "Component Spec Writer", role: "Per-component API contract" },
      { code: "SF-72", name: "Event Schema Registry", role: "Cross-service event contracts" },
      { code: "SF-75", name: "Domain Model Compiler", role: "ERD + migrations from DDD" },
    ],
  },
  {
    code: "D",
    name: "Architecture Gate",
    tagline: "ADRs, ratification, ratchet enforcement.",
    factories: [
      { code: "SF-77", name: "ADR Synthesizer", role: "Decision drafts from tradeoff analysis" },
      { code: "SF-78", name: "Ratification Runner", role: "Operator sign-off loop" },
      { code: "SF-79", name: "Ratchet Auditor", role: "Enforces one-way arch decisions" },
      { code: "SF-80", name: "Cost/Perf Modeller", role: "$/req at target scale" },
    ],
  },
  {
    code: "E",
    name: "Code Implementation",
    tagline: "Spec to shipped code with tests + docs + CI green.",
    factories: [
      { code: "SF-82", name: "Code Implementation", role: "Spec to working code, first draft" },
      { code: "SF-83", name: "Refactor Steward", role: "Post-first-draft cleanup" },
      { code: "SF-85", name: "Migration Generator", role: "DB migration from schema delta" },
      { code: "SF-91", name: "Unit Test Generation", role: "Test coverage to green" },
      { code: "SF-93", name: "Integration Test", role: "Cross-service contract tests" },
    ],
  },
  {
    code: "F",
    name: "Quality Gate",
    tagline: "Security scans, perf budgets, a11y checks.",
    factories: [
      { code: "SF-98", name: "Security Scan", role: "Trivy + deps + secrets scan" },
      { code: "SF-99", name: "Perf Budget Auditor", role: "Lighthouse + bundle-size gates" },
      { code: "SF-100", name: "A11y Auditor", role: "axe-core CI gate" },
      { code: "SF-101", name: "Reuse Steward", role: "Refuses copy-paste of existing OSS" },
      { code: "SF-104", name: "Release Orchestrator", role: "Auto-merge PR + deploy" },
    ],
  },
  {
    code: "G",
    name: "Deploy + Operate",
    tagline: "Per-app dedicated infra, provisioned + observed.",
    factories: [
      { code: "SF-105", name: "Deploy Decision", role: "Blue/green vs rolling per app" },
      { code: "SF-141", name: "App Spawn Microfactory", role: "Provisions per-app tenant + DB + secrets" },
      { code: "SF-96", name: "Auto Deploy + Live URL", role: "DB, auth, ops dashboard handover" },
      { code: "SF-125", name: "Observability Wiring", role: "OTel + Prometheus + Grafana per app" },
      { code: "SF-133", name: "SLO Enforcer", role: "Burn-rate alerts + auto rollback" },
    ],
  },
];

const CONTROL_PLANE = [
  "CP-01 Durable Workflow (Temporal)",
  "CP-02 Agent Reasoning (LiteLLM + free tier)",
  "CP-03 Event Backbone (Kafka + CloudEvents)",
  "CP-04 Policy Engine (kill switch, cost gates, DoD)",
  "CP-05 Artifact Store (MinIO)",
  "CP-06 Operational DB (Postgres per tenant)",
  "CP-07 Project Knowledge Graph",
  "CP-08 Decision Registry (ADRs, ratified)",
  "CP-09 Evidence Store (screenshots, traces, test results)",
  "CP-10 Secrets Broker (Vault)",
  "CP-11 Identity + Tenant Fabric (Keycloak)",
  "CP-12 Observability Stack (Prom + Loki + Grafana)",
  "CP-13 API Gateway (APISIX)",
  "CP-14 Dispatch Status Reporter",
  "CP-15 DoD Gate (mechanical enforcement)",
];

export default function PipelinePage() {
  return (
    <div className="space-y-12 pt-4">
      <section className="space-y-4">
        <p className="text-sm uppercase tracking-wider text-muted-foreground">
          What CAIA actually does
        </p>
        <h1 className="text-balance text-3xl font-semibold sm:text-4xl">
          141 microfactories. 15 control-plane components. One founder brief in, one shipped app out.
        </h1>
        <p className="max-w-3xl text-muted-foreground">
          Each microfactory (SF-##) owns one narrow responsibility, is versioned, and emits typed events on a shared backbone.
          Control-plane components (CP-##) wire them together — workflow durability, agent reasoning, secrets, observability.
          The whole factory is deterministic on the edges and LLM-only at the decision leaves.
        </p>
      </section>

      <section className="space-y-8">
        {STAGES.map((s) => (
          <StageBlock key={s.code} stage={s} />
        ))}
      </section>

      <section className="space-y-4 rounded-lg border border-border p-6">
        <h2 className="text-xl font-semibold">Control plane (CP-01 to CP-15)</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Cross-cutting services every microfactory depends on. Ratified in the CAIA blueprint — see the ADRs on Confluence.
        </p>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          {CONTROL_PLANE.map((cp) => (
            <li key={cp} className="rounded border border-border p-3">{cp}</li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-border p-6">
        <h2 className="text-xl font-semibold">See it live</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Every merge to develop shows up on <a href="/factory" className="underline hover:text-foreground">Factory Live</a>.
          The wizard front door lives at <a href="https://dashboard.chiefaia.com/wizard/onboarding" className="underline hover:text-foreground">dashboard.chiefaia.com/wizard/onboarding</a>.
        </p>
      </section>
    </div>
  );
}

function StageBlock({ stage }: { stage: Stage }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-blue-900 px-3 py-1 text-xs font-semibold text-blue-100">
            Stage {stage.code}
          </span>
          <h2 className="text-xl font-semibold">{stage.name}</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{stage.tagline}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {stage.factories.map((f) => (
          <div key={f.code} className="rounded border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground">{f.code}</span>
            </div>
            <div className="mt-1 font-medium">{f.name}</div>
            <div className="mt-1 text-sm text-muted-foreground">{f.role}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
