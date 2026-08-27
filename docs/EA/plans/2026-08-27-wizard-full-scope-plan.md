# Wizard full-scope plan — 2026-08-27 overnight batch

**Directive** (operator, 2026-08-27, autonomous multi-hour window):
"Do it in a loop mode where you keep checking… I won't be here… I need to see this entire thing running end to end. Without any blockers, do not wait for my answers. Just go with whatever."

## Scope captured from prompt

### Cross-cutting (Phase A — foundations that unblock everything below)

- **A1. Durable session** — expand `lib/session/tokens.ts` into a full `useSession()` module. Save every input, every generated doc, every screen picked, every epic completed to localStorage under a namespaced project id. Rehydrate on page load. On login, persist localStorage to backend account (stub the DB write for now).
- **A2. Explainers everywhere** — new `<StageExplainer title/body/why>` shown at the top of every wizard step. New `<InputExplainer>` shown under every textarea/input. Both are 1-3 sentence "what & why" copy.
- **A3. Input validation lib** — reject: empty, <10 chars, >5000 chars, all-caps, all-digits, gibberish (repeat chars, no vowels), obvious PII (SSN, credit-card patterns), obvious HTML/script injection. Show inline validation messages with the [[browser-test-first]] tone.
- **A4. AI call cache/dedupe** — hash (purpose+prompt) → response, TTL 24h. Server-side in-memory + client-side localStorage. Prevents duplicate calls when a user re-mounts or navigates back.
- **A5. Voice-to-text mic** — `<VoiceInput>` wraps any textarea; uses Web Speech API (`webkitSpeechRecognition`). Toggle mic button, live transcription, appends to the underlying textarea.
- **A6. AI failure graceful UI** — `<AiFailurePanel>` + friendly toast with retry. Never show raw errors. Uses [[browser-test-first]] "our AI provider is a bit slow, click again" copy pattern.
- **A7. Loader pattern** — `<ProcessLoader status="…" substeps={[…]}>` with animated dots + rotating "current step" line ("Thinking about your idea…" → "Drafting landing copy…" → "Rendering preview…").
- **A8. Header changes** — replace "Dashboard" with **Login** button (when logged out) or user avatar (when logged in). Add **Docs folder icon** with counter; opens dropdown of generated startup docs.
- **A9. Project-start login gate** — clicking "New project" triggers login modal with **Google / Apple / Email / Login later** options. Login-later continues anonymous into localStorage-only mode.

### Phase B — Startup documents system

- **B1. Canonical doc list** — finalize the 10-15 docs founders/VCs actually want:
  1. Executive Summary
  2. Business Plan (long)
  3. Pitch Deck (10-12 slides)
  4. One-Pager
  5. Financial Model / P&L Projection (3-yr)
  6. Cap Table + Fundraising Plan
  7. Go-To-Market Plan
  8. ICP + Personas
  9. Competitive Analysis
  10. Product Requirements Doc (PRD)
  11. Roadmap (Now/Next/Later)
  12. Tech Architecture Overview
  13. Brand Guidelines / Style Guide
  14. Legal Structure + IP Strategy
  15. Metrics / KPI Dashboard Definition
- **B2. Generic doc generator** — `POST /api/wizard/docs/generate` with `{ docType, projectContext }`, returns markdown + metadata. gpt-4o-mini for shorter, mistral-large for long-form. Cached per A4.
- **B3. PDF viewer component** — `<PdfViewer url>` uses `react-pdf` (MIT). Server-side markdown→PDF via `@react-pdf/renderer` or headless-chrome print-to-pdf.
- **B4. PPTX viewer** — client-side render via `pptxjs` or generate pptx server-side with `pptxgenjs`, then convert first slide to preview image; embed via iframe fallback (Office Online Embed).
- **B5. Docs folder dropdown** — header icon opens panel listing generated docs with type/date/size, click → open viewer modal.
- **B6. First-doc → login prompt** — after the first doc is generated (Executive Summary right after Proposal), a modal explains "save your work" with login options.

### Phase C — MVP breakdown → design picker → epic-by-epic build

- **C1. Finalized MVP scope template** — sections: Vision, Target user (ICP), Core value prop, Non-goals, Success metrics, Constraints, Feature list (prioritized), Design principles.
- **C2. Data grid hierarchy** — Initiatives → Epics → Stories → Tasks as expandable accordion. Left-side breakdown panel; user can rearrange, add, remove. Auto-populated by LLM but editable.
- **C3. Design-system / style-guide / theme picker stories** — 3 auto-injected stories at the top of "Design" epic:
  - Story: Pick your design system (shadcn/ui, MUI, Chakra, Ant Design, custom)
  - Story: Pick your style guide (minimal, warm, corporate, playful, editorial, brutalist)
  - Story: Pick your theme (light/dark/auto, accent color, radius, font family)
- **C4. Epic-by-epic build** — build one epic at a time. Left = story checklist + current epic progress bar. Right = real web page preview (Sandpack + Tailwind CDN loader per [[wizard-mvp-flow-shipped]]). LLM generates code per story, appends to running app, live-renders.
- **C5. Responsive viewport dropdown** — right panel top: Phone (390×844) / Tablet (768×1024) / Desktop (1440×900) toggle. Iframe wrapped in device chrome.

### Phase D — All 140+ SF phases in sidebar

- **D1. Sidebar sections** — Done ✓ · In Progress • · To Do ○. All 141 SFs from [[caia-master-blueprint]] listed. Read from `/api/caia/factories/status`. Auto-updates as SFs complete.

### Phase E — Post-payment loop

- **E1. After stage 9**: continue the loop — for each SF (SF-10 onwards), plan → architect → build → live-test → confirm → next. Same pattern as this batch, autonomous, per [[browser-test-first]].

## Execution order

Tier 1 (foundation): A1 → A2 → A3 → A7 → A6 → A4 → A5 → A8 → A9
Tier 2 (docs): B1 → B2 → B3 → B4 → B5 → B6
Tier 3 (MVP): C1 → C2 → C3 → C4 → C5
Tier 4 (SFs): D1
Tier 5 (post-pay loop): E1

## Persistence guarantee

Every file below is written to disk (`/home/s903/caia/…`) as it is built. Every commit is pushed to `feat/wizard-full-scope-2026-08-27`. Every deploy is systemd `chiefaia-wizard.service` restart. Nothing lives only in RAM.

## References

- [[wizard-mvp-flow-shipped]] · [[browser-test-first]] · [[openrouter-only]] · [[deferred-physical-tenant]] · [[byok-first-ai]] · [[ship-dont-plan]] · [[no-standby-between-iterations]]
