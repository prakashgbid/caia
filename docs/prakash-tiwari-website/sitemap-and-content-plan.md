---
name: prakash-tiwari-com-sitemap-and-content-plan
created: 2026-05-16T16:25:00Z
updated: 2026-05-16T16:39:00Z
status: design-blocked-on-inputs
type: design
chain: prakash-website-sitemap-content / phase 1 of 1
spawn_id: phase1-20260516T162500-96077
scope: prakash-tiwari.com — personal/professional promotional site
canonical_path: docs/prakash-tiwari-website/ (caia repo, branch prakash-website-design-system-2026-05-16)
sibling_specs:
  - docs/prakash-tiwari-website/README.md        # design system v1.0
  - docs/website-tech-architecture.md is sibling caia work; this site's tech-arch lives at ~/.caia/inputs/prakash-website/tech-architecture.md (handoff copy)
---

# prakash-tiwari.com — Sitemap & Content Plan

> **Phase 1 of 1.** This document specifies the information architecture, page-by-page outline, SEO approach, and content-execution plan for **prakash-tiwari.com** — Prakash Tiwari's personal/professional promotional site. The visual identity is fixed by the sibling design-system spec (`README.md`). The technical stack and hosting are fixed by the tech-architecture spec (`tech-architecture.md`, handoff). This document is the bridge: it tells a content writer and a designer what to put on which page, in what tone, and why.

---

## 0. Status & inputs-gate result

**The phase ran with a 60-minute polling window for two operator-staged inputs:**

| Input | Expected path | Found? |
|---|---|---|
| Resume | `~/.caia/inputs/prakash-website/resume.pdf` *or* `resume.docx` | ❌ **not staged** |
| LinkedIn URL | `~/.caia/inputs/prakash-website/linkedin.txt` (first line is the URL) | ❌ **not staged** |

Neither input landed during the polling window. Per the phase's standing rule (`Do NOT proceed with fabricated content`), this document **does not invent biographical facts**. Every place where biographical fact should appear (a role title, a year, a stat, a specific area of expertise, a named achievement) is marked with one of the placeholder tokens below; the document is otherwise complete and executable.

| Placeholder | Intended substitute |
|---|---|
| `{{HEADLINE_ROLE}}` | A single-sentence professional summary line ("software architect", "platform-systems engineer", "AI-systems builder", etc.) — drawn from resume header. |
| `{{EXPERTISE_AREAS_3_TO_5}}` | 3-to-5 short noun phrases — e.g. "distributed systems", "AI orchestration", "data platforms". Drawn from resume "Skills" / "Areas of expertise". |
| `{{CAREER_NARRATIVE_2_PARA}}` | Two paragraphs telling the career story across roles — phrased as themes, not employer names. |
| `{{ACHIEVEMENT_BULLETS_4_TO_8}}` | Hard-won outcomes: numbers, scope, impact — without naming the employer who scoped the work. |
| `{{CURRENT_FOCUS_AREAS}}` | 2-3 themes the person is actively working on today (problem spaces, not project names). |
| `{{WRITING_LIST_OR_OMIT}}` | A list of essays / talks / public artifacts if the resume implies any; otherwise the entire **Writing** route is omitted from the build. |
| `{{CONTACT_HANDLES}}` | The exact set of contact handles the resume + LinkedIn allow us to publish (email, LinkedIn URL, optional GitHub / Mastodon). No social-media spam. |
| `{{LOCATION_LINE}}` | Optional location line — city / time zone only, never address. |

The plan below is structurally complete and the writer hand-off is concrete. **§7 (Content Gaps)** enumerates every placeholder with the resume question that resolves it.

The phase **exits non-zero** because the gate condition (inputs present) was not met; the document is delivered alongside the failure signal so downstream work has something to start from once the operator stages the resume.

---

## 1. Audience analysis

The audience for a personal-professional site is narrower than a product site. A useful test: imagine you've just told someone your name at a conference, in a hiring email, or in a press request, and they type "prakash tiwari" into a search bar. **The visitor already knows who you are by name**; the site's job is to confirm what kind of professional you are and give them one useful next action.

Five concrete personas drive every page decision:

### 1.1 The recruiter (or hiring partner)
**Trigger:** They have a role to fill and your name surfaced via LinkedIn, a referral, or a previous interaction. They will spend **30–90 seconds** on the homepage before deciding to move on or to bookmark for outreach.

**What they need:**
- A one-line answer to "what does this person do?"
- A scannable list of expertise areas — for keyword match against their JD.
- A clear path to either (a) résumé download, (b) email contact, or (c) the LinkedIn profile.
- Trust signals (years of experience, scope of recent work, optional writing).

**What they *don't* need:** narrative storytelling, long-form essays, project deep-dives. They will not read more than two paragraphs on this visit.

### 1.2 The prospective collaborator / co-founder / consulting client
**Trigger:** Someone in their network has mentioned you, or they read something you wrote. They have **2–5 minutes** to spend and are trying to decide whether to reach out.

**What they need:**
- A sense of *how you think*, not just what you've done. Short-form essays or thinking-out-loud pieces serve this far better than bullet-pointed accomplishments.
- Concrete proof of capability in their specific domain — they self-filter to the expertise area they care about.
- A low-friction contact path with a clear expectation of response time.

**What they *don't* need:** a chronological CV, a full work history, junior credentials.

### 1.3 The peer professional (engineer, designer, researcher) — "informed curiosity"
**Trigger:** They saw your name in a comment thread, a conference roster, or a citation. They're scoping you the same way you'd scope them: curious, skeptical, looking for signal.

**What they need:**
- Substance over polish. A peer reading "transformed customer engagement leveraging AI" will close the tab. They want concrete artifacts: writing, repos (only if the resume implies any public OSS), a precise expertise vocabulary.
- Evidence of taste — both in writing and in design. The site itself is part of the artifact set.

**What they *don't* need:** a sales pitch, testimonials, badges-from-employers.

### 1.4 The journalist / podcaster / press contact
**Trigger:** They are working on a story or episode and your name came up as a possible source or guest. They have **under 2 minutes**, and they want a bio block they can paste into a pitch + a way to reach you.

**What they need:**
- A copy-pasteable bio at three lengths (one-line, paragraph, full bio). Bios are useful to journalists, conference organisers, and anyone introducing you.
- A high-resolution headshot (single download).
- Contact path with a low-friction promise — "I usually reply within X business days" is enough.

**What they *don't* need:** browsing — they're not exploring; they're scoping.

### 1.5 The "Googled your name" general visitor
**Trigger:** A reference check, a curious customer, a former colleague, a relative. Wildly varied intent; the only commonality is **they don't know what they're looking for**.

**What they need:**
- A clear, calm, professional first impression. The homepage must answer "what does this person do and roughly how serious are they about it" within a glance.
- Permission to leave. The site doesn't trap; there are no popups, newsletters, or social-share intercepts.

**What they *don't* need:** anything specific — and that's the design constraint. The homepage must be useful to this persona *without* sacrificing depth for the other four.

### 1.6 Persona priorities

The homepage is tuned for **Personas 1, 4, and 5** (recruiter, journalist, general). Depth surfaces for **Personas 2 and 3** (collaborator, peer) live one click deeper — on `/about`, `/work`, and (if writing exists) `/writing`. This is the single most important information-architecture decision in the document and it dictates the rest.

---

## 2. Top-level navigation

The navigation is **five visible items**, with optional **two** more conditionally surfaced based on what the resume implies. Total ceiling: **seven**. This sits inside the ceiling specified by the task brief (5–7).

### 2.1 Canonical nav (always present)

| # | Label | Route | Why it earns a slot |
|---|---|---|---|
| 1 | (logo / wordmark) | `/` | Returns to home. The wordmark is the name set in Inter Medium, sized small. No icon. |
| 2 | **About** | `/about` | Persona-2/3/4 deep-read surface. The professional narrative lives here. |
| 3 | **Work** | `/work` | The "what I do" page — expertise areas + selected achievements without naming employers. |
| 4 | **Writing** | `/writing` | Conditional: present if resume implies essays/talks/published pieces. See §2.3. |
| 5 | **Contact** | `/contact` | Single CTA destination. The site's most-clicked link after the homepage. |

The `Home` label is **not** present in the nav itself — the wordmark is the home affordance. This is the convention on Anthropic, Linear, Stripe Press, and Maggie Appleton's site, and matches the editorial aesthetic of the sibling design system.

### 2.2 Optional nav (conditional)

| Label | Route | Surfaced when |
|---|---|---|
| **Speaking** | `/speaking` | Resume / LinkedIn lists ≥ 3 conference talks, panels, or recorded interviews. Below that threshold, talks fold into `/writing` or `/work`. |
| **Notes** | `/notes` | Operator opts in to short-form writing (link logs, technical notes, reading list). Distinct from long-form `/writing`. Default: **off**. |

Together, the canonical four + (Writing if applicable) + (Speaking if applicable) stays within the 7-item ceiling.

### 2.3 The Writing decision

`/writing` is the highest-leverage conditional route. Two paths:

- **Resume implies ≥ 2 published pieces, talks, or essays.** Build `/writing` with a chronologically-reverse list page + per-essay routes. This is the path most editorial-personal sites take (Maggie Appleton, Brian Lovin, Robin Sloan).
- **Resume implies 0–1 published pieces.** Drop the `/writing` route entirely. A near-empty Writing index reads worse than no index at all. If the operator wants to *start* writing on the site, scaffold the route but don't ship it until 3 pieces exist.

The placeholder `{{WRITING_LIST_OR_OMIT}}` triggers this decision at content-fill time.

### 2.4 Nav rendering

From the design-system spec:

- Navigation type: **Inter Medium 14–15px, ink color, ample horizontal spacing (`space-6` / 24px between items).**
- Active route: **`accent` underline** (1px, with `text-underline-offset: 6px`).
- Mobile breakpoint: ≤ 640px collapses to a hamburger that opens a full-page sheet (no half-modal). Sheet content: nav links + contact CTA + small footnote "© 2026 Prakash Tiwari".
- No dropdowns. No mega-menus. Flat structure end-to-end.

### 2.5 Footer cross-nav

The footer (`<footer>` on every page) repeats the canonical nav plus the contact handles. See §6 for the full footer scaffold.

---

## 3. Page-by-page outline

Each page below specifies (a) intent, (b) section breakdown, (c) draft paragraphs grounded only in placeholder slots (never in invented biography), (d) visual notes that reference design-system tokens, and (e) the SEO-relevant fields. Where two-to-three paragraphs of draft copy are required, the placeholder is the paragraph — a content writer with the resume in hand can fill it in without rewriting the structure.

### 3.1 Home — `/` (`index.md`)

**Intent.** Answer "what does this person do?" in under five seconds. Direct the visitor to one of three next destinations: About, Work, or Contact.

#### Section A — Hero

- **Composition.** Asymmetric. Display-size headline (1 line, 4.5rem at desktop) on the left half. White space on the right. No hero image, no decorative shapes. The page background is the warm-paper token (`#FAF8F4`).
- **Headline copy.** "{{HEADLINE_ROLE}}." — one declarative sentence. Examples of *shape* (not content): "Engineer working on distributed AI systems." / "Designer focused on quiet, calm product interfaces." / "Researcher building tools for thinking." The headline must be a single short sentence, ≤ 60 characters, set in Inter Medium 500 (NOT bold).
- **Subhead (h2-sized in serif).** One paragraph (~30 words) elaborating the headline. Drawn from the resume's "Professional Summary" block. Use Source Serif 4 to set the editorial register up front.
- **Primary CTA.** A single text link to `/about` reading "More about how I work →". No buttons in the hero. Tertiary visual weight.

**Draft copy slot.** *(Writer fills from resume header + summary; do not invent.)*

> **{{HEADLINE_ROLE}}**
>
> {{HERO_SUBHEAD_PARAGRAPH}} *(One paragraph, ~30 words, drawn from resume "Professional Summary" or LinkedIn "About". If neither exists, derive from the top of the resume.)*
>
> More about how I work →

#### Section B — Expertise strip

- **Composition.** A horizontal row (desktop) / 2-column grid (mobile) of 3-to-5 expertise areas, each a one-word or short-phrase label set in `eyebrow` style (12px Inter, uppercase, +10% tracking, `ink-muted` color).
- **Source.** `{{EXPERTISE_AREAS_3_TO_5}}` — verbatim from resume skills/expertise block. Do **not** rewrite them in marketing voice.
- **No icons.** The design system spec forbids decorative iconography here.

**Draft copy slot.**

> {{EXPERTISE_AREA_1}}  ·  {{EXPERTISE_AREA_2}}  ·  {{EXPERTISE_AREA_3}}  ·  {{EXPERTISE_AREA_4_OPTIONAL}}  ·  {{EXPERTISE_AREA_5_OPTIONAL}}

#### Section C — Selected work (3 items, no employer names)

- **Composition.** Three card-shaped blocks stacked vertically (desktop: max 720px column, centered). Each card: an eyebrow label ("PROJECT" or "WORK"), a one-line description, a body-paragraph (~40 words), and a "read more" link to `/work`.
- **Critical rule.** Each card describes the *problem* and the *outcome*, never the *employer*. Example shape (not content): *"Designed and deployed a distributed AI orchestration layer that handled X traffic at Y latency. Shipped over Z months."* — no company name, no team name.
- **Source.** Drawn from resume achievement bullets, restated into problem-outcome paragraphs.

**Draft copy slot — Card 1 (placeholder shape).**

> **PROJECT**
>
> **{{WORK_ITEM_1_TITLE}}** *(8–12 words, problem-oriented title)*
>
> {{WORK_ITEM_1_PARAGRAPH}} *(~40 words. Lead with problem, end with outcome. Do not name employer.)*
>
> See full work →

Repeat the same shape for cards 2 and 3.

#### Section D — Closing CTA strip

- **Composition.** A single paragraph + one inline-text CTA, centered, generous vertical padding (`space-3xl` / 96px above and below).
- **Copy.**

> Looking for a {{HEADLINE_ROLE_TYPE_NOUN}}? I take on a small number of engagements each year.  **Get in touch →**

The `{{HEADLINE_ROLE_TYPE_NOUN}}` is the noun form of the headline role — "advisor", "engineer", "consultant", "collaborator". Pull from resume positioning.

#### Visual notes

- **Headshot:** *not* on the homepage. The design-system spec is explicit about no decorative hero image; the headshot lives on `/about` only.
- **Background:** `paper` (#FAF8F4 light, #14130F dark). Hero has no gradient, no pattern.
- **Spacing:** Hero block has `space-4xl` (128px) top padding desktop and `space-3xl` (96px) bottom padding. Subsequent sections separated by `space-3xl` (96px) vertical.
- **Container:** 720px reading column for body, 1120px for the expertise strip + work cards.

#### SEO

| Field | Value |
|---|---|
| `<title>` | `Prakash Tiwari — {{HEADLINE_ROLE}}` |
| Meta description (≤ 155 chars) | `{{HOME_META_DESCRIPTION}}` — one sentence echoing the hero subhead. Must contain "Prakash Tiwari" once. |
| OG image | `/og-default.png` (1200×630, headline text only, paper background, accent underline) |
| Canonical | `https://prakash-tiwari.com/` |
| `lang` | `en` |

---

### 3.2 About — `/about` (`about.md`)

**Intent.** The professional narrative. Persona-2/3 spend the most time here. Long-form, serif-set, editorially-paced.

#### Section A — Page kicker

- An eyebrow label "ABOUT" (12px Inter eyebrow, accent color), a serif-set h1 ("About"), then a single sub-paragraph (~30 words) that previews the page in the same voice the visitor will read.

#### Section B — Headshot block

- **Composition.** Single square headshot (max 320×320 displayed, served at 2×). Centered on mobile, left-aligned with a 480px right-of-headshot biography paragraph on desktop.
- **Caption** below the image: location + optional ("based in {{LOCATION_LINE}}, working with teams remotely") — drawn from resume header / LinkedIn location.

#### Section C — Career narrative (2 paragraphs)

The longest piece of prose on the site. Two paragraphs of body-large serif (`body-lg`, Source Serif 4, 20px).

**Paragraph 1: trajectory.** What does the writer's career arc look like, told as a sequence of *interests and themes*, never as a list of employers? "I began working on X, then spent several years going deep into Y, and these days I'm focused on Z." The shape is chronological, but the entities are problem domains, not company names. Roughly 80–100 words.

**Paragraph 2: how I think / what I bring.** The "operating principles" paragraph — the working style, the kind of problem the person enjoys, the kind of team they're useful on. Roughly 80–100 words.

**Draft copy slots.**

> {{CAREER_NARRATIVE_PARA_1}}
>
> {{CAREER_NARRATIVE_PARA_2}}

The writer is reminded: do **not** name any current or past employer. Themes only. If the resume has an unavoidable employer (e.g., the brand-name itself signals scale), the operator must explicitly approve mentioning it; default is **omit**.

#### Section D — Achievements (highlights, not a CV)

- **Composition.** 4–8 bullet-style items, each a one-sentence outcome with a number where possible. Set in body-sans (Inter 16px), generous vertical rhythm.
- **Critical rule.** Same employer-suppression rule as Section C. Numbers and scope matter; employers don't.

**Draft copy slot.**

> - {{ACHIEVEMENT_BULLET_1}}  *(e.g., "Shipped a {{system noun}} that processed {{N}} {{unit}} per day at {{latency}} p95.")*
> - {{ACHIEVEMENT_BULLET_2}}
> - {{ACHIEVEMENT_BULLET_3}}
> - {{ACHIEVEMENT_BULLET_4}}
> - {{ACHIEVEMENT_BULLET_5_OPTIONAL}}
> - {{ACHIEVEMENT_BULLET_6_OPTIONAL}}
> - {{ACHIEVEMENT_BULLET_7_OPTIONAL}}
> - {{ACHIEVEMENT_BULLET_8_OPTIONAL}}

#### Section E — Three-length bio block (press-ready)

A subtle, designed block titled "**Bios**" with three nested code-style blocks (use `paper-sunken` background, mono font for the block contents). Each block is copy-pasteable.

**Draft copy slots.**

> **One-line bio.**
> ```
> {{BIO_ONE_LINE}}  (≤ 25 words)
> ```
>
> **Paragraph bio.**
> ```
> {{BIO_PARAGRAPH}}  (50–80 words)
> ```
>
> **Long bio.**
> ```
> {{BIO_LONG}}  (150–200 words)
> ```

Press contacts copy these directly without writing. This single section is high-leverage and easy to overlook.

#### Section F — Closing CTA

A single line: "Want to work together? **Get in touch →**" linking to `/contact`.

#### Visual notes

- **Headshot:** square, soft-edge rounded corners (`8px`), no harsh border. Loaded with `<Image>` from Astro for responsive widths.
- **Reading column:** 65–72 character measure for the serif body (`max-width: 640px`).
- **Section dividers:** thin hairline (`#E5E1D8`, 1px) between Sections C → D and D → E. None elsewhere — the rhythm carries the structure.

#### SEO

| Field | Value |
|---|---|
| `<title>` | `About — Prakash Tiwari` |
| Meta description | `{{ABOUT_META_DESCRIPTION}}` — a tightened version of `{{BIO_ONE_LINE}}`, ≤ 155 chars, name first. |
| OG image | Per-page OG with "About" eyebrow + headline. Generated at build time from a template. |
| Canonical | `https://prakash-tiwari.com/about` |

---

### 3.3 Work — `/work` (`work.md`)

**Intent.** Show what kind of problems the person works on, framed as *expertise themes and selected outcomes*. This page must satisfy Persona 1 (recruiter doing JD match) and Persona 3 (peer scoping technical depth) without naming any employer.

#### Section A — Page kicker

Eyebrow "WORK", h1 "Work", one-paragraph preview (~30 words) explaining the framing: "I work on {{HEADLINE_ROLE_TYPE_NOUN}}-shaped problems; below is a selected set."

#### Section B — Expertise themes (3–5)

The structural backbone of the page. Each theme is its own block:

- An h3 (24px Inter Medium) naming the theme.
- A one-paragraph (~50 words) description of the *kind* of problem this theme covers and how the person approaches it.
- A bulleted list of 2–4 concrete outcomes within this theme (each a one-sentence achievement statement, no employer name).

**Draft copy slot per theme.**

> ### {{EXPERTISE_THEME_1}}
>
> {{EXPERTISE_THEME_1_PARAGRAPH}}
>
> - {{THEME_1_OUTCOME_1}}
> - {{THEME_1_OUTCOME_2}}
> - {{THEME_1_OUTCOME_3_OPTIONAL}}

Repeat for themes 2 through 5. Most resumes will yield 3–4 strong themes; 5 is the cap.

#### Section C — Engagements & availability

A short block (~80 words of body sans) describing how the person engages with work — full-time hire, advisory, contract, consulting — and at what scope. This is the page that converts Persona 2 (prospective collaborator). One sentence per engagement type the operator wants to invite; if they only want full-time roles, this is one sentence.

**Draft copy slot.**

> {{ENGAGEMENTS_PARAGRAPH}}
>
> If you have a problem that sounds like one of the above, **get in touch →**.

#### Section D — Optional: resume download

- A small subdued line: "**Resume:** [download PDF]({{RESUME_PDF_PATH}})". This is the only place on the site that hosts the resume; not in the nav.
- The PDF is `public/resume.pdf` — placed by the operator, regenerated from the latest source manually. Filename: `prakash-tiwari-resume.pdf` (the slug is part of the SEO surface — recruiters often share the URL).
- If the operator doesn't want to expose the resume publicly, this entire section is dropped and the contact page becomes the only path to the PDF (gated via email reply).

#### Visual notes

- Expertise themes use a left-aligned eyebrow "01 · " "02 · " number prefix (in `ink-muted`, mono) above the h3. The numbering is a quiet editorial cue, not loud.
- Outcome bullets use a thin `accent`-colored vertical rule on the left (`border-left: 2px solid var(--accent); padding-left: space-3;`) to create a calm visual scaffold without a heavy bullet glyph.
- No images on `/work` — the page is text-first. (If the operator wants to add diagrams later, they go in individual case-study sub-pages, which are deferred to a future phase.)

#### SEO

| Field | Value |
|---|---|
| `<title>` | `Work — Prakash Tiwari` |
| Meta description | `{{WORK_META_DESCRIPTION}}` — list the expertise themes joined by commas, prefixed with "Prakash Tiwari works on", ≤ 155 chars. |
| OG image | Per-page OG with the expertise-themes list rendered as a vertical stack of eyebrows. |
| Canonical | `https://prakash-tiwari.com/work` |

---

### 3.4 Writing — `/writing` (`writing.md`) — CONDITIONAL

Only built if the resume / LinkedIn list ≥ 2 public writing artifacts. Otherwise this route is omitted from the build (the nav item is hidden conditionally via Astro's content-collection check).

**Intent.** Index of essays, talks, podcast appearances, or other public writing. The point of `/writing` is to expose *how* the person thinks; the design must avoid blog-platform conventions (no "Read more →" link bait, no "share on Twitter" buttons, no view counts).

#### Section A — Page kicker

Eyebrow "WRITING", h1 "Writing", one-paragraph preview explaining what kinds of pieces appear here.

#### Section B — Reverse-chronological list

Each entry: a single block with

- An eyebrow "ESSAY" / "TALK" / "INTERVIEW" / "NOTE" (matching the content kind).
- Date as `YYYY · Month` set in `caption` style.
- The title as h3 (linked to either an internal route `/writing/<slug>` if the piece is reproduced on-site, or an external URL with a small `↗` glyph).
- A 2-sentence summary (~30 words) set in body sans.

Spacing: each entry separated by `space-2xl` (48px). No grid; vertical column at the 720px reading width.

**Draft copy slot.**

> {{WRITING_LIST_OR_OMIT}} → if non-empty, render entries; if empty, omit the route entirely.

#### Section C — RSS link (optional)

A small line at the bottom: "Subscribe via [RSS]({{RSS_FEED_PATH}})". RSS is the only subscription affordance — no email newsletter, no popups, no "subscribe" CTAs. This is consistent with the design-system spec's anti-tracking posture.

#### Visual notes

- No author byline on internal essay pages (the site IS the author).
- No reading-time estimate. The serif typography is the editorial signal.
- Code blocks inside essay pages use JetBrains Mono on the `paper-sunken` background per the design-system spec.

#### SEO

| Field | Value |
|---|---|
| `<title>` | `Writing — Prakash Tiwari` |
| Meta description | `{{WRITING_META_DESCRIPTION}}` — short summary of recurring themes, name first. |
| OG image | List page: same template as other pages. Each individual essay generates its own OG with the essay title as headline. |
| Canonical | `https://prakash-tiwari.com/writing` |

---

### 3.5 Contact — `/contact` (`contact.md`)

**Intent.** Single CTA destination. The Reach-Me page must be uncluttered, low-friction, and clearly state expectations.

#### Section A — Page kicker

Eyebrow "CONTACT", h1 "Get in touch", one-paragraph preview (~30 words) on response expectations.

**Draft copy.**

> I read every message and reply within {{RESPONSE_WINDOW_DAYS}} business days, more or less. If your message is time-sensitive, say so in the first line.

#### Section B — Primary contact: email

Single line, the highest visual weight on the page after the h1:

> ☐ **{{PRIMARY_EMAIL}}** ↗

Format: the email address linked via `mailto:`, set in serif at body-lg size, on the page's primary axis. Underneath, a one-line caption: "Direct email — best for most things."

Recommendation: use `hello@prakash-tiwari.com` routed via Cloudflare Email Routing per the tech-arch spec (§4 of `tech-architecture.md`).

#### Section C — Secondary contact paths

A short list, each a single line:

- **LinkedIn:** [{{LINKEDIN_HANDLE_SHORTFORM}}]({{LINKEDIN_URL}}) ↗  · *"For professional context."*
- **GitHub:** [{{GITHUB_HANDLE}}]({{GITHUB_URL}}) ↗  · *(only if the resume implies public OSS work; default: hide)*
- **Mastodon / Bluesky / etc.:** *only if the operator already uses these professionally; default: hide all social. Twitter/X is explicitly OFF the list per the design-system spec's anti-tracking ethos and the "no social-media spam" instruction.*

The `{{CONTACT_HANDLES}}` placeholder resolves to whatever subset the operator chooses to publish.

#### Section D — Optional: contact form

Per the tech-arch spec's §7, the contact form is **optional** and a `mailto:` link is the default. If the operator decides to add a form:

- 3 fields only: name, email, message.
- Turnstile widget below the message field (invisible to humans).
- "Send" button uses the accent color, single state.
- On success, the page replaces the form with a single line: "Thanks — I'll be in touch."
- On failure, a one-line error inviting the visitor to email directly: "Something went wrong — email me at {{PRIMARY_EMAIL}}."

The form is **not** the primary contact path. The email line above it is. The form is courtesy for visitors who prefer not to open their mail client.

#### Section E — Location & availability (one line, optional)

> Based in {{LOCATION_LINE}}. Open to {{CURRENT_AVAILABILITY}} engagements.

If the operator does not want to publish location, drop the first half. The second half clarifies — for Personas 1 and 2 — whether the person is open to work today.

#### Visual notes

- The page is **deliberately empty above the fold** — generous whitespace. The email line is large; everything else is small.
- The fold should hit a few millimeters above the secondary-contact list, so the primary contact dominates the first viewport.
- No headshot on `/contact`. The page is a question, not an introduction.

#### SEO

| Field | Value |
|---|---|
| `<title>` | `Contact — Prakash Tiwari` |
| Meta description | `Email {{PRIMARY_EMAIL}} to reach Prakash Tiwari directly. Usually a {{RESPONSE_WINDOW_DAYS}}-business-day response.` |
| OG image | Per-page OG with "Contact" eyebrow + email rendered as the headline. |
| Canonical | `https://prakash-tiwari.com/contact` |
| `<link rel="me" href="{{PRIMARY_EMAIL_MAILTO}}">` | for IndieAuth / future portability |

---

### 3.6 Optional pages

#### 3.6.1 Speaking — `/speaking` (conditional)

If conferences/talks ≥ 3, this page mirrors `/writing`'s structure: reverse-chronological list of talks with title, date, venue (only if the venue is the speaker's choice — e.g., "Local Meetup, City"; commercial conference names are usually safe to mention because the venue is the brand, not the operator's employer).

If conferences/talks < 3, fold them into `/writing` as `TALK`-eyebrow entries, and omit `/speaking` entirely.

#### 3.6.2 Notes — `/notes` (off by default)

A short-form micro-blog surface — link logs, reading lists, technical scratch. **Off by default.** If the operator wants this, scaffold the route but commit a single `notes/_intro.md` explaining the cadence so visitors don't expect daily content.

#### 3.6.3 404 page — `/404`

- Simple. The wordmark, an h1 "Page not found", one paragraph, a single link back to home.
- Copy: "That page isn't here. **Try the homepage** or **drop me a note** if you were looking for something specific."

---

## 4. "Current Work" framing — how to surface ongoing work without naming employers / projects

This is the most-thought-about section of the document and the one that requires the most discipline from the writer. The standing rule is: **Do not reference any organization, project, or product affiliation he holds. Do not name any current employer, company, or initiative. Speak only about him as an individual professional.**

That rule, naively applied, eliminates content. But the resume contains real, meaningful current-work signal — and the site loses value if it papers over what the person actually does today. The framing strategy below lets the site discuss current work substantively while staying inside the rule.

### 4.1 The three frames

Pick the right frame for the right surface. Most current-work content will use Frame B; the homepage hero uses Frame A; long-form bio paragraphs use Frame C.

**Frame A — Domain framing.** "I work on `<domain>` problems." Domain names are abstract: *distributed systems, AI orchestration, data platforms, design systems, applied ML, developer tools, healthcare interoperability*. The domain is the operator's expertise area — not their employer. Use on: homepage hero subhead, expertise strip, OG meta description.

**Frame B — Problem framing.** "I help teams build `<X>` that handle `<Y>` at `<Z>`." Specifies the kind of problem and its scope without referencing the team that scoped it. Example shapes (not content): *"I help teams build AI agent infrastructure that runs reliably at production scale."* / *"I design and ship developer tools that get adopted across large engineering orgs."* Use on: expertise themes, work cards, achievement bullets.

**Frame C — Theme framing.** "These days I'm spending most of my time on `<theme>`." A theme is a long-arc interest: *"the gap between research-grade ML and production systems"*, *"the role of editorial taste in software interfaces"*, *"making large codebases legible to autonomous agents"*. Themes are personal even when the work happens inside an organisation. Use on: about page narrative paragraph 1 final sentence, optional notes page intro.

### 4.2 Concrete substitutions

When the resume has employer-named achievements, restate them using these substitutions:

| Employer-named (resume) | Site-safe restatement |
|---|---|
| "At Acme Corp, led the migration of …" | "Led the migration of … *(no mention of Acme)*" |
| "Built X for Y team at Z Inc." | "Built X for a team running at Y-scale." |
| "Currently at Foobar Inc, working on …" | "Currently spending most of my time on …" |
| "Founder/CEO of Widget Co" | This one is **harder**. If the operator's founder identity is part of their brand and the operator explicitly wants it on the site, get explicit approval and surface it once on `/about`. Otherwise, restate as "I founded and led a {{noun}} company." with no name. |

The writer must read every achievement bullet and ask: "Could a competitor of {{employer}} read this without learning {{employer}}'s playbook?" If the answer is yes, the framing is safe. If no, soften the statement (move from product-specific to outcome-specific) until it is yes.

### 4.3 The "I'm currently doing X" sentence

The site has exactly **one** moment that says "right now": the second sentence of the About page's career narrative paragraph 1, or the closing sentence of the hero subhead. Pick one — not both. The current-work sentence is the most-likely to drift toward naming an employer; isolate it so it's easy to review.

Recommended shape:

> "These days I'm focused on {{CURRENT_FOCUS_AREA_1}}, with side time on {{CURRENT_FOCUS_AREA_2_OPTIONAL}}."

Both placeholders resolve to *theme* nouns, not employer / project names.

### 4.4 What current-work content is NOT allowed

- Any company logo, screenshot, or branded asset.
- Any product name belonging to a current or past employer.
- Any project repository URL that's not in the operator's personal namespace.
- Any testimonial that contains an employer name (a clean testimonial like "Prakash is sharp and direct" is fine; "Prakash transformed our X system at Acme" is not).
- Any "currently building <X>" line that names a venture the operator is keeping off this site.

### 4.5 Future-proofing

When the operator changes roles, the site changes in **one place**: the `{{CURRENT_FOCUS_AREA_1}}` line in `about.md`. No employer dates to update. No "Currently at…" line to flip. This is a feature of the design — it minimizes the maintenance tax of being a working professional with a personal site.

---

## 5. SEO basics

The site is small (≤ 10 pages), so SEO discipline is concentrated in a few high-leverage decisions rather than spread across a sprawling content strategy.

### 5.1 Primary keyword: the person's name

The dominant search query the site needs to win is **`prakash tiwari`** — the exact-name query. Sub-queries include:

- `prakash tiwari {{EXPERTISE_AREA_1}}` (e.g., "prakash tiwari machine learning")
- `prakash tiwari linkedin` (the site should rank, but is unlikely to beat LinkedIn itself — that's fine)
- `prakash tiwari blog` / `prakash tiwari writing` (if writing exists)
- `prakash tiwari resume` (the most common recruiter search)
- `prakash tiwari speaking` / `prakash tiwari talks` (conditional)

The site does not try to rank for generic queries — it can't and doesn't need to.

### 5.2 Page-level SEO

Every page exposes these fields. Defaults below; per-page overrides in §3.

| Field | Pattern |
|---|---|
| `<title>` | `<Page name> — Prakash Tiwari` (homepage: `Prakash Tiwari — {{HEADLINE_ROLE}}`) |
| Meta description | One sentence, ≤ 155 chars, contains "Prakash Tiwari" once, contains the page's primary noun once. |
| Canonical URL | Apex domain, no trailing slash on sub-routes. |
| `lang` | `en` |
| Robots | `index, follow` everywhere except `/404` (`noindex, nofollow`) |
| Open Graph | `og:type=profile` on `/`, `/about`; `og:type=article` on individual `/writing/<slug>` pages; `og:type=website` elsewhere. `og:image` is the per-page generated OG image. |
| Twitter Card | `summary_large_image`. (Card markup only — no link to a Twitter handle in the head; the design-system spec excludes Twitter/X.) |
| JSON-LD | `schema.org/Person` on `/about` with `name`, `jobTitle: {{HEADLINE_ROLE}}`, `url: https://prakash-tiwari.com`, `sameAs: [{{LINKEDIN_URL}}, ...]`. **Do not** include `worksFor` in the schema (employer-suppression rule applies to structured data too). |

### 5.3 Sitemap & robots

- `/sitemap.xml` — auto-generated at build time by Astro's `@astrojs/sitemap` integration. Includes every published route. `/notes` and `/writing/*` only appear if their respective content collections have published items.
- `/robots.txt` —

  ```
  User-agent: *
  Allow: /
  Sitemap: https://prakash-tiwari.com/sitemap.xml
  ```

  No AI-training opt-outs — neither in robots.txt nor in HTTP headers. The site is text-first and small; an AI training set ingesting it is a non-issue. (If the operator changes their mind, this is a one-line change.)

### 5.4 Structured data hygiene

- A single `Person` JSON-LD block on `/about`. Do not put `Person` on every page (Google explicitly discourages this).
- A `BlogPosting` block on each `/writing/<slug>` page (if `/writing` exists).
- No `Organization` block anywhere. The site has no organisation.

### 5.5 No analytics-driven SEO

The tech-arch spec uses Cloudflare Web Analytics (privacy-first, no Google Search Console wiring). Search Console integration is **optional** — the operator can add it later via a DNS TXT verification if they want to monitor query-level performance. Default: don't bother.

---

## 6. Cross-link patterns & footer scaffolding

### 6.1 Inter-page cross-link rules

Personal sites get cross-linking wrong by either (a) crowding pages with "you may also like" rows or (b) leaving pages dead-ended with no next-action. The rules below split the difference:

**Rule 1 — Every page ends with one CTA, not a list.**
- Home → "More about how I work →" (to About)
- About → "Want to work together? Get in touch →" (to Contact)
- Work → "If this resonates, get in touch →" (to Contact)
- Writing → no CTA. The reading list IS the page.
- Individual essay → "← Back to writing" only. No "Read more" of other essays.
- Contact → no CTA. Email link IS the CTA.

**Rule 2 — Nav and footer are the discovery surface, not in-page links.**
The site does not have "see also" or "related" blocks anywhere. Inter-page navigation happens via the persistent nav and footer. This keeps page bodies focused on the prose.

**Rule 3 — Within-page inline links use accent color and follow the typographic underline rule.**
- Inline links: `accent` color with a 1px underline at `text-underline-offset: 3px`.
- External links: same styling, with a small `↗` glyph appended in `caption` size.
- Hover: shift to `accent-hover`, no decoration change.

### 6.2 Footer scaffold

The footer appears on every page. It is set in `paper-sunken` (`#F2EFE9` light, `#0D0C0A` dark) with a 1px `line` top border. Inner padding `space-2xl` vertical, container 1120px.

Layout: **three columns on desktop, stacked on mobile.**

**Column 1 — Identity.**

```
Prakash Tiwari
{{HEADLINE_ROLE}}
{{LOCATION_LINE}}
```

Set in body-sans 14px. No wordmark image — the name is rendered as text.

**Column 2 — Routes.**

Each route as a single line, Inter 14px, `ink-muted` color (slightly muted in the footer).

```
About
Work
Writing      (conditional)
Speaking     (conditional)
Contact
```

**Column 3 — Contact handles.**

```
hello@prakash-tiwari.com    (mailto link)
LinkedIn ↗                  (external link)
GitHub ↗                    (optional, conditional)
RSS                         (conditional on /writing)
```

**Footer bottom row** (full-width below the three columns):

```
© 2026 Prakash Tiwari        ·        Site source on GitHub ↗        ·        Built with Astro
```

Year is the current calendar year — Astro renders dynamically. The "Site source" link goes to the public repository (if the operator chooses to make it public; otherwise drop). The "Built with Astro" line is optional editorial — it's quiet and signals to peers that the site is hand-built.

### 6.3 Cross-link safety check

Before publishing each page, the writer should run this checklist:

- [ ] Every link in the page body goes to either: (a) another page on this site, (b) an essay/talk explicitly listed on `/writing`, or (c) an external link the operator personally signed off on.
- [ ] No link goes to a current or past employer's site.
- [ ] No link goes to a project / product repo owned by an organisation the operator wants off this site.
- [ ] The footer's "Site source" link points to the operator's personal namespace repo, not an employer-owned one.

---

## 7. Content gaps

This section enumerates **every** input the operator must provide before the site can ship, organised by the page that consumes it. Items at the top of the list block the most pages and should be staged first.

### 7.1 Critical — blocks ≥ 3 pages

| # | Gap | Resolves | Notes |
|---|---|---|---|
| 1 | **Resume file** at `~/.caia/inputs/prakash-website/resume.pdf` or `.docx` | All biographical placeholders (~30 across the site) | This is the inputs-gate failure. Until this file lands, the site cannot be filled in. |
| 2 | **LinkedIn URL** at `~/.caia/inputs/prakash-website/linkedin.txt` (URL on first line) | `{{LINKEDIN_URL}}`, `{{LINKEDIN_HANDLE_SHORTFORM}}`, partial cross-check on resume facts | Public profile only; if auth-walled, the resume is the sole source. |
| 3 | **Headshot** — single high-res JPEG/PNG | `/about` Section B | Square crop, minimum 800×800 (will be served at 320×320 displayed, 2× for retina). Neutral background preferred; design-system spec wants editorial / calm framing. |

### 7.2 Important — blocks 1–2 pages

| # | Gap | Resolves |
|---|---|---|
| 4 | **One-line headline role** | `{{HEADLINE_ROLE}}` — homepage hero, `<title>`, footer Column 1 |
| 5 | **3–5 expertise areas** (verbatim from resume) | `{{EXPERTISE_AREAS_3_TO_5}}` — homepage strip, `/work` themes |
| 6 | **4–8 achievement bullets**, employer-suppressed | `{{ACHIEVEMENT_BULLETS_4_TO_8}}` — `/about` Section D |
| 7 | **3 selected work items** with problem + outcome paragraphs | Homepage Section C cards |
| 8 | **Three-length bio** (one-line / paragraph / long) | `/about` Section E press bios |
| 9 | **Current focus areas** (1–2 themes, NO employer names) | `{{CURRENT_FOCUS_AREAS}}` — `/about` paragraph 1 final sentence |
| 10 | **Primary email address** for the public contact line | `{{PRIMARY_EMAIL}}` — `/contact` Section B, footer |
| 11 | **Response window** the operator wants to promise | `{{RESPONSE_WINDOW_DAYS}}` — `/contact` Section A |
| 12 | **Engagement availability** sentence | `{{ENGAGEMENTS_PARAGRAPH}}`, `{{CURRENT_AVAILABILITY}}` — `/work` Section C, `/contact` Section E |
| 13 | **Location preference** (city / region / "remote-first" / nothing) | `{{LOCATION_LINE}}` — `/about` caption, footer |

### 7.3 Optional — conditional pages

| # | Gap | Resolves |
|---|---|---|
| 14 | List of essays, talks, podcasts, public writing | `{{WRITING_LIST_OR_OMIT}}` — whether `/writing` ships at all |
| 15 | List of conference / panel / interview appearances | Whether `/speaking` ships as a separate route |
| 16 | GitHub / Mastodon / Bluesky handles | Whether secondary contact lines appear on `/contact` |
| 17 | Public OSS work links (in operator's personal namespace) | Optional `/work` Section B sub-bullets |

### 7.4 Site-asset gaps

| # | Gap | Resolves |
|---|---|---|
| 18 | **Favicon** — single SVG, monogram-free per design-system rule | `/public/favicon.svg` |
| 19 | **Default OG image** (1200×630, paper background, "Prakash Tiwari" wordmark + accent rule) | `/public/og-default.png` and a per-page Astro Image template |
| 20 | **Resume PDF** for download (if §3.3 Section D is enabled) | `/public/resume.pdf` |
| 21 | **MIT/license decision** for the site source | `LICENSE` file, repo metadata |
| 22 | **Site source repo URL** if `Site source on GitHub` footer link is enabled | Footer bottom row |

### 7.5 Resolution sequence

1. Operator stages **resume.pdf** and **linkedin.txt** under `~/.caia/inputs/prakash-website/`.
2. Re-run this phase (or a dedicated content-fill phase) to extract resume facts and substitute every placeholder.
3. Operator reviews the filled draft for employer-suppression compliance.
4. Designer requests **headshot** + provides **default OG image**.
5. Operator decides on **Writing** / **Speaking** route inclusion.
6. Build, preview, ship.

---

## 8. Execution handoff

### 8.1 What a content writer needs (input package)

To fill in this plan, a content writer needs:

1. The resume — full text, current version.
2. The LinkedIn public profile — read access.
3. A 30-minute call with the operator to confirm:
   - Headline role wording.
   - Employer-suppression sensitivity (any specific brand the operator wants to suppress *or* explicitly mention).
   - Voice / register preferences ("I", "we", or "third person").
   - Tolerance for self-aggrandisement (some operators are comfortable with "expert", "leading", "renowned"; others find them cringe-inducing — most personal-professional sites should default to flat, observational voice).
4. A first-draft review window of 24 hours after the filled-in draft lands.

### 8.2 What a designer needs (input package)

To execute this plan visually, a designer needs:

1. The sibling design-system spec (`README.md`) — already complete.
2. The Tailwind config (`tailwind.config.ts`) — already complete.
3. The pseudo-HTML component examples (`components.html`) — already complete.
4. The headshot file at the agreed resolution.
5. A default OG image at 1200×630 with the wordmark and accent underline.

The designer can mock up all five core pages in Figma in approximately a half-day given the inputs above; the Astro implementation is a separate phase.

### 8.3 Out of scope for this phase

- Astro template implementation (a separate `prakash-website-build` chain).
- Individual essay drafting (the operator writes; this phase does not generate writing content).
- Photography / headshot direction (a separate operator task).
- Email / contact-form backend wiring (specified in the tech-arch spec §7).
- Analytics setup (specified in the tech-arch spec §6).

### 8.4 Acceptance criteria for the filled-in draft

A content writer's filled-in draft is accepted when:

- [ ] Every `{{PLACEHOLDER}}` token in this document has been replaced or explicitly removed (in which case the surrounding sentence is also rewritten to flow).
- [ ] No employer / project / product name appears anywhere on the site (run a final grep against the resume's "Experience" section employer names).
- [ ] All paragraph-length copy fits within the 65–72-character measure when rendered (the writer doesn't need to manually format, but should check that paragraph lengths don't balloon past ~5 sentences).
- [ ] The three-length bio block on `/about` is the *only* place the long-form bio appears verbatim.
- [ ] The contact email is verified working via Cloudflare Email Routing before the page goes live.
- [ ] Every link in the page bodies has been clicked once to confirm destination.

---

## 9. Appendix — content writer's quick reference

A condensed checklist a writer can paste into a working doc.

**Tone.**
- Quiet. Editorial. Flat — observational rather than promotional.
- "I" for first-person, present-tense for current work, past-tense for past work.
- No buzzwords: avoid "passionate", "transformative", "thought leader", "synergy", "leverage", "guru", "ninja", "rockstar".
- Prefer numbers to adjectives. "Shipped a system that handled 50k req/s" beats "Shipped a high-performance system".

**Length.**
- Hero subhead: ~30 words.
- About narrative paragraphs: ~80–100 words each.
- Achievement bullets: 1 sentence, ~20 words.
- Work-card paragraphs: ~40 words each.
- Three-length bios: ≤ 25, 50–80, 150–200 words.

**Employer-suppression rule.**
- Never name a current or past employer.
- Never name a project owned by an employer.
- Restate every achievement as a *problem + outcome* not a *team + product*.
- When in doubt, ask the operator.

**Cross-link rules.**
- One CTA per page (see §6.1).
- Inline links use accent color.
- External links carry the `↗` glyph.

**Voice samples (shape only — not content).**

> *(Editorial / first-person.)* "I work on systems that need to stay calm under load, and most of what I've spent the last decade on is some flavour of that problem."

> *(Editorial / first-person.)* "These days I'm focused on the gap between research-grade machine learning and production systems that operations teams can actually run."

> *(Achievement bullet.)* "Designed and deployed a routing layer that served 30k requests per second across three regions, with a 99th-percentile latency under 50 milliseconds."

> *(One-line bio.)* "Prakash Tiwari is a {{noun}} working on {{domain}}, based in {{LOCATION_LINE}}."

These are templates, not drafts — they show the *shape* of acceptable copy without inventing facts.

---

## 10. Phase exit

This document is delivered as the canonical sitemap-and-content plan for `prakash-tiwari.com`, complete in every section that does **not** require operator-staged biographical inputs. The plan is suitable for hand-off to a content writer the moment the resume and LinkedIn URL land at `~/.caia/inputs/prakash-website/`.

**Inputs gate result:** ❌ resume and linkedin.txt absent at end of polling window.

**Exit code:** non-zero (per phase contract).

**Next action (operator-only):** stage `resume.pdf` (or `resume.docx`) and `linkedin.txt` under `~/.caia/inputs/prakash-website/` and re-spawn a content-fill chain to substitute every `{{PLACEHOLDER}}` in this document.

— end of plan —
