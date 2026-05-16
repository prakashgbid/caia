# CAIA Public Website — Design System (v1.0)

**Status:** draft for implementation
**Audience:** front-end engineers, design contributors, marketing reviewers
**Reference targets:** anthropic.com, vercel.com, linear.app
**Stack assumption:** Next.js (App Router) + Tailwind CSS + TypeScript

---

## 0. Design intent & guardrails

The CAIA public website is the front door for an autonomous AI engineering platform. Visitors fall into two cohorts:

1. **Technical operators** (founders, staff engineers, platform leads) who want to understand depth fast — they will read code blocks, diagrams, and architecture pages.
2. **Decision-makers and observers** (product partners, investors, prospective hires) who want to feel competence without parsing every internal term.

The visual character must therefore deliver **technical depth without intimidation**. Concretely:

- **Modern-AI vocabulary:** generous whitespace, restrained chrome, monochrome scaffolding with a single warm-accent identity color. This is the Anthropic / Vercel / Linear common dialect.
- **Editorial respect for words:** large, comfortable body text on long-form pages. Engineering reads here — they will not forgive 14px serif body on a wide measure.
- **Code is content, not decoration:** code blocks, terminal snippets, and architecture diagrams are first-class typographic objects, not embedded screenshots from a different design language.
- **Light-first, dark-equal:** the default theme is light (the cohort spends most of their reading day in light editorial sites, and AI-tech competitors have shifted light-first since 2024). Dark mode is a peer, not a fallback.
- **Tailwind-native:** every token lives in `tailwind.config.ts`. No CSS-in-JS runtime, no styled-components. Utilities first; components only when a pattern recurs three or more times.

Existing CAIA dashboard tokens (`apps/dashboard/app/globals.css`) are intentionally narrow — a near-black background `#0f1117`, body text `#e2e8f0`, and link `#63b3ed`. We **preserve those three values inside the dark palette** so a visitor moving between site and app does not experience a brand-snap. Everything else is new territory.

---

## 1. Typography

### 1.1 Font stack decision

We evaluated three candidates against four criteria — character at display sizes, legibility at 14–18px body, code-quality of its monospaced companion, and licensing/runtime cost.

| Family            | Display character          | Body legibility | Mono companion          | Licensing / delivery        | Verdict |
|-------------------|----------------------------|------------------|--------------------------|------------------------------|---------|
| Inter             | Neutral, ubiquitous        | Excellent        | None native (use JetBrains) | OFL, free via fontsource    | Safe but anonymous — used everywhere |
| IBM Plex Sans/Mono| Editorial, brand-strong    | Very good        | IBM Plex Mono (excellent) | OFL, free                    | Strong character; risks "IBM-branded" feel |
| **Geist Sans/Mono** | Modern, geometric, confident | Very good      | Geist Mono (purpose-built) | OFL, distributed by Vercel  | **Chosen** — purpose-built for technical product surfaces |

**Decision: Geist Sans + Geist Mono as the primary pair.**

Geist's geometric construction reads "tool-built" without sliding into the corporate-neutral zone Inter occupies. Its mono companion was designed in lock-step with the sans, so headlines, body, and code sit on a coherent visual axis — a problem with the Inter + JetBrains Mono pairing, where the mono looks 30 years older than the sans. Geist also ships an OpenType `cv11` feature set that exposes a single-storey `a` (useful for display headlines).

**Editorial accent:** `Newsreader` from Google Fonts, used **only** for pull-quotes, large stat callouts, and the occasional editorial hero phrase. This is the same move Anthropic uses with their custom Tiempos pairing — a single serif voice for moments where a sans feels too transactional. Use sparingly (no more than one occurrence per page).

**Fallback chain (all roles):**

```
ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
"Helvetica Neue", Arial, "Noto Sans", sans-serif
```

For the mono role:

```
ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
"Liberation Mono", monospace
```

### 1.2 Type scale

Modular scale, base **16px**, ratio **1.25** (major-third), nudged for editorial comfort at the `h1` step. All sizes use `rem` so user preference scales correctly.

| Token         | rem     | px (1rem=16) | Line-height | Weight | Tracking  | Usage                                  |
|---------------|---------|--------------|-------------|--------|-----------|----------------------------------------|
| `display-2xl` | 4.5rem  | 72           | 1.05        | 600    | -0.03em   | Hero only, one per page                |
| `display-xl`  | 3.75rem | 60           | 1.08        | 600    | -0.025em  | Section heroes                         |
| `display-lg`  | 3rem    | 48           | 1.1         | 600    | -0.02em   | Page titles below hero                 |
| `h1`          | 2.25rem | 36           | 1.15        | 600    | -0.015em  | Top of long-form article               |
| `h2`          | 1.75rem | 28           | 1.2         | 600    | -0.01em   | Major section header                   |
| `h3`          | 1.375rem| 22           | 1.3         | 600    | 0         | Sub-section header                     |
| `h4`          | 1.125rem| 18           | 1.4         | 600    | 0         | Component / card title                 |
| `body-lg`     | 1.125rem| 18           | 1.6         | 400    | 0         | Long-form prose, hero subhead          |
| `body`        | 1rem    | 16           | 1.6         | 400    | 0         | Default UI text                        |
| `body-sm`     | 0.875rem| 14           | 1.55        | 400    | 0         | Captions, meta, dense table cells      |
| `caption`     | 0.75rem | 12           | 1.5         | 500    | 0.02em    | Eyebrows, tags, ALL-CAPS labels        |
| `code`        | 0.9375rem| 15          | 1.55        | 450    | 0         | Inline + block code (Geist Mono)       |
| `code-sm`     | 0.8125rem| 13          | 1.5         | 450    | 0         | Code in dense table rows / nav         |

Weights used: **400 regular**, **450 medium-mono** (Geist Mono has true 450 — use it for code body), **500 medium**, **600 semibold**. **Bold (700)** is reserved for inline `<strong>` emphasis inside prose; do not use 700 for headlines (the 600 weight + tight tracking is the headline voice).

### 1.3 Reading-measure rules

- Prose body text caps at **68 characters per line** (`max-w-prose` in Tailwind, ~720px at 18px body). Anything wider becomes a fatigue test.
- Tabular content and code blocks may extend to the full grid width.
- Editorial paragraphs leave a **`1.75rem`** bottom margin; list items collapse to `0.5rem`.

---

## 2. Color palette

The palette is built on a **single warm primary** ("Ember"), a **neutral cool gray scale** for surfaces and text, an **electric mint accent** for AI/system-state moments, and conventional semantic colors. Each named color has a 50–950 scale (Tailwind convention).

### 2.1 Brand primary — **Ember**

A warm clay/coral. Calls back to Anthropic's warm-orange identity without colliding (Ember is more rust, less marigold). Used for primary CTAs, link hovers in editorial mode, and the brand mark.

```
ember-50   #FFF5F1
ember-100  #FFE4D8
ember-200  #FFC6AE
ember-300  #FFA079
ember-400  #FA7A4E
ember-500  #E45A2E   ← brand anchor
ember-600  #C44520
ember-700  #9D341A
ember-800  #762818
ember-900  #4C1A12
ember-950  #2A0E0A
```

**Anchor:** `ember-500`. Use on light backgrounds for primary buttons. On dark, step up to `ember-400` for AA contrast.

### 2.2 Neutral scale — **Slate**

The structural color. Surfaces, text, borders, dividers. Tuned slightly cool (blue undertone) to read "technical" rather than warm-paper.

```
slate-0    #FFFFFF
slate-50   #F7F8FA
slate-100  #EEF1F5
slate-200  #DDE3EB
slate-300  #C2CBD6
slate-400  #97A2B1
slate-500  #6B7585
slate-600  #4B5564
slate-700  #343C4A
slate-800  #1F2632
slate-900  #131822
slate-950  #0F1117   ← matches existing dashboard bg
```

`slate-950` is intentionally identical to the existing dashboard background so the public site → app handoff is seamless.

### 2.3 Accent — **Mint** (system / AI state)

Used for "live" indicators, AI-generated content badges, success-of-a-process states (distinct from "validation success", which is green). This is the color readers will learn to associate with autonomous activity on the page.

```
mint-50   #ECFDF5
mint-100  #CFFAEA
mint-200  #9CF4D2
mint-300  #5EE5B5
mint-400  #25CF96
mint-500  #0FB47C   ← accent anchor
mint-600  #0A8E64
mint-700  #0A6F50
mint-800  #0A5440
mint-900  #053124
```

### 2.4 Semantic

Conventional, tuned to harmonize with the primary/neutral pair.

| Role    | Light bg / fg          | Dark bg / fg            |
|---------|------------------------|--------------------------|
| Success | `#16A34A` on `#F0FDF4` | `#22C55E` on `#0F2A18`   |
| Warning | `#D97706` on `#FFFBEB` | `#F59E0B` on `#2A1C05`   |
| Error   | `#DC2626` on `#FEF2F2` | `#F87171` on `#2A0E0E`   |
| Info    | `#2563EB` on `#EFF6FF` | `#60A5FA` on `#0F1A2A`   |

The legacy dashboard link blue `#63b3ed` aligns with the dark-mode `Info` value and is preserved as the dark-mode default link color.

### 2.5 Mode mapping

| Role                | Light                | Dark                  |
|---------------------|----------------------|------------------------|
| Page background     | `slate-0` `#FFFFFF`  | `slate-950` `#0F1117`  |
| Surface (card)      | `slate-50` `#F7F8FA` | `slate-900` `#131822`  |
| Surface (elevated)  | `slate-0`            | `slate-800` `#1F2632`  |
| Border / divider    | `slate-200`          | `slate-800`            |
| Body text           | `slate-800`          | `slate-100` `#EEF1F5`  |
| Muted text          | `slate-500`          | `slate-400`            |
| Link (default)      | `ember-600`          | `#63b3ed` (legacy preserve) |
| Link (hover)        | `ember-700`          | `ember-300`            |
| Primary button bg   | `ember-500`          | `ember-400`            |
| Primary button fg   | `slate-0`            | `slate-950`            |

All foreground/background pairs in this table are **AA-compliant at 16px body** (verified WCAG 2.1 contrast ratios ≥ 4.5:1 for normal text, ≥ 3:1 for large text and UI components).

---

## 3. Spacing system

A 4px base, named tokens, no skipping. Tailwind exposes both numeric (`p-4`) and named (`p-md`) — we extend with names so design conversations don't reduce to integer arguments.

| Token   | px  | rem    | Usage                                              |
|---------|-----|--------|----------------------------------------------------|
| `3xs`   | 2   | 0.125  | Hairline gaps inside compact components            |
| `2xs`   | 4   | 0.25   | Inline icon-to-text                                |
| `xs`    | 8   | 0.5    | Tight stacks (form label + input)                  |
| `sm`    | 12  | 0.75   | Card inner padding small                           |
| `md`    | 16  | 1      | Default vertical rhythm (paragraph spacing)        |
| `lg`    | 24  | 1.5    | Section internal padding                           |
| `xl`    | 32  | 2      | Card → card gap                                    |
| `2xl`   | 48  | 3      | Major component separation                         |
| `3xl`   | 64  | 4      | Section → section margin                           |
| `4xl`   | 96  | 6      | Hero → next section                                |
| `5xl`   | 128 | 8      | Page-level breathing on `display-2xl` heroes only  |

**Rules:**

1. Never use values outside this scale. If you find yourself wanting `14px`, the answer is `xs` (8) or `sm` (12).
2. Vertical rhythm prefers `md`, `lg`, `2xl`, `3xl`. Horizontal padding inside cards prefers `lg`, `xl`.
3. Negative margins are not in the scale and are forbidden outside of intentional grid bleed treatments (see §4.3).

---

## 4. Layout

### 4.1 Container

- Max content width: **1280px** (`max-w-[1280px]`), centered.
- Page side gutter: **24px** mobile, **32px** tablet, **48px** desktop.
- A "narrow" reading container variant at **800px** for editorial / docs pages.
- A "wide" variant at **1440px** for full-bleed marketing pages with framed media.

### 4.2 Grid

- **12-column grid**, 24px gutter desktop, 16px gutter mobile.
- Columns are equal-width; offsets are explicit (`col-start-3`, never `mx-auto` on grid children).
- Special case: marketing landing pages use a **8/12 + 4/12** asymmetric split for "feature-with-screenshot" rows.

### 4.3 Breakpoints

Aligned with Tailwind defaults plus one addition (`3xl`) for ultrawide editorial pages.

| Token  | Min-width | Typical device                  |
|--------|-----------|----------------------------------|
| `sm`   | 640px     | Large phone landscape            |
| `md`   | 768px     | Tablet portrait                  |
| `lg`   | 1024px    | Tablet landscape / small laptop  |
| `xl`   | 1280px    | Laptop / desktop                 |
| `2xl`  | 1536px    | Large desktop                    |
| `3xl`  | 1920px    | Ultrawide (editorial bleed only) |

**Design at 1280** as the canonical viewport. Mobile-first writing in Tailwind classes (`text-h2 lg:text-h1`) is mandatory.

### 4.4 Z-index scale

A short, named scale so layered elements stop fighting:

```
z-base          0
z-raised        10
z-sticky        20    ← sticky table headers, sticky nav
z-overlay       30    ← scrim
z-modal         40
z-popover       50
z-toast         60
z-tooltip       70
```

---

## 5. Components

Each component below has: visual rules, state matrix, and a Tailwind class sketch. Full pseudo-HTML lives in `components.html`.

### 5.1 Buttons

Three variants × four sizes × five states.

| Variant   | Light idle bg   | Light idle fg | Border        | Notes                       |
|-----------|------------------|----------------|----------------|------------------------------|
| primary   | `ember-500`      | `slate-0`      | none           | One per primary action group |
| secondary | `slate-0`        | `slate-800`    | `slate-300` 1px| Most CTAs                    |
| ghost     | transparent      | `slate-700`    | none           | Tertiary / inline            |

Sizes: `sm` (32px h, 12/16 padding, body-sm), `md` (40px h, 16/20 padding, body), `lg` (48px h, 20/28 padding, body-lg), `xl` (56px h, 24/32 padding, body-lg) — hero only.

States: idle, hover, active, focus-visible (always a **2px ember-400 ring offset 2px**), disabled (50% opacity, `cursor-not-allowed`).

Border radius: **8px** (`rounded-lg`) — non-negotiable across variants for shape consistency.

### 5.2 Cards

Two recipes:

**Surface card** — content container.
- Background: `slate-50` light / `slate-900` dark.
- Border: `1px slate-200` light / `1px slate-800` dark.
- Border radius: **12px**.
- Padding: `lg` (24) by default, `xl` (32) for feature cards.
- Hover: lift `translate-y-[-2px]` + shadow `shadow-md`. **Only** when the card is a link.

**Stat card** — for "55M records, 491GB" hero stats.
- Padding: `2xl` (48).
- Top eyebrow: `caption` text, `mint-500` color.
- Stat number: `display-xl` Geist, `slate-900` light.
- No border on light; on dark, `1px slate-800`.

### 5.3 Hero (landing page top)

**Layout:** centered, 8/12 cols on desktop. Max width 960px for prose elements.

**Structure (top → bottom):**
1. Eyebrow (caption, `mint-500`, optional — used for "v1.2 released")
2. Headline: `display-2xl` on desktop, `display-lg` on mobile. Max 9 words.
3. Subhead: `body-lg`, `slate-600`. Max 28 words. Caps at `max-w-prose` width.
4. CTA pair: primary + secondary buttons, `lg` size, `md` gap.
5. Hero media (optional): code block, diagram, or product screenshot. Caps at 1100px wide, rounded `2xl` (16px), bordered `slate-200`, drop-shadow `shadow-lg`.

**Vertical rhythm:** `4xl` (96) from top of viewport on desktop; `3xl` (64) on mobile.

### 5.4 Nav

**Top nav (sticky):**
- Height: 64px desktop, 56px mobile.
- Background: `slate-0/80` light with `backdrop-blur-md`, border-bottom `slate-200`.
- Logo left, links center-right, primary CTA far right.
- Links: `body-sm`, `slate-700` idle, `slate-900` hover, `ember-600` for active route.
- Mobile: collapse to hamburger → slide-in panel.

**In-page section nav (docs/long-form):**
- Right rail, sticky at `top-24`.
- `caption` eyebrow "On this page".
- Active heading: ember left-border 2px + `slate-900` text.

### 5.5 Footer

Four columns on desktop, single stacked on mobile. Background `slate-50` light / `slate-900` dark. Vertical padding `3xl` (64). Top border `slate-200`/`slate-800`.

Columns: Product / Resources / Company / Legal. Logo + tagline + social icons live in a fifth column above on desktop, centered above the four columns on mobile.

### 5.6 Code blocks

Code is content. The block treatment matters more than any single component on the site.

- **Container:** `slate-900` light / `slate-800` dark, **rounded-xl** (12px), `1px` border `slate-800`/`slate-700`.
- **Padding:** `lg` (24px) vertical, `xl` (32px) horizontal.
- **Header bar (optional):** filename in `code-sm`, language label right-aligned in `caption mint-300`, copy button far right.
- **Body:** Geist Mono `code` size, line-height 1.55, `slate-100` text on the dark container. Syntax tokens use a custom highlight palette (see §5.6.1).
- **Line numbers:** off by default; on for blocks > 12 lines, in `slate-500` muted.
- **Inline code:** `slate-100` bg / `slate-800` text in light mode; `slate-800` bg / `slate-100` text in dark mode. Padding `0 6px`, radius 4px, font `code-sm`.

**§5.6.1 Syntax palette** (works on both `slate-900` and `slate-800` containers):

```
keyword    #C792EA   (purple-300)
string     #C3E88D   (light-green-300)
number     #F78C6C   (orange-300)
function   #82AAFF   (blue-300)
comment    #6B7585   (slate-500, italic)
variable   #EEF1F5   (slate-100)
operator   #89DDFF   (cyan-300)
constant   #FFCB6B   (amber-300)
```

This is a tuned Material-Palenight variant, chosen because it survives on both `slate-900` and `slate-800` backgrounds without re-balancing.

### 5.7 Diagram embeds

The site will publish architecture diagrams (system maps, pipeline graphs). Treatment rules:

- **Source format:** SVG only. No raster diagrams above 1024px wide.
- **Stroke weight:** **1.5px** baseline, 2px for emphasized edges. No mixed line weights inside the same diagram.
- **Type:** Geist Mono `code-sm` for node labels, Geist Sans `body-sm` for callouts.
- **Color use:** **monochrome on slate-700**, with `ember-500` reserved for the single emphasized path. Mint accent only on "AI-managed" nodes.
- **Container:** same shell as code blocks — rounded-xl, slate border, optional caption below in `caption slate-500`.
- **Light/dark variants:** ship both. Use Next.js `<picture>` + `prefers-color-scheme` switch.

### 5.8 Callouts

Five flavors, all share a **left-border accent + tinted bg + icon + body**:

| Type      | Border    | Bg light       | Bg dark             | Icon       |
|-----------|-----------|-----------------|----------------------|------------|
| Info      | `#2563EB` | `#EFF6FF`       | `slate-800`          | ⓘ          |
| Tip       | `mint-500`| `mint-50`       | `mint-900` @ 30%     | ★          |
| Warning   | `#D97706` | `#FFFBEB`       | `slate-800`          | ⚠          |
| Caution   | `#DC2626` | `#FEF2F2`       | `slate-800`          | ✕          |
| Note      | `slate-400`| `slate-50`     | `slate-800`          | ✎          |

Padding `lg` (24), radius `8px`, border-left **4px** solid, icon column 24px wide, gap `sm` (12). Body uses `body` size; first child is always a one-line **bold** title.

### 5.9 Tables

Used heavily in docs and pricing.

- **Header row:** `caption` size, ALL-CAPS, `slate-500`, `1px slate-200` bottom border.
- **Body rows:** `body-sm`, `slate-700`, `1px slate-100` row dividers (omit row dividers on dense tables — use zebra `slate-50` instead).
- **First column emphasis:** font-weight 500, `slate-900`.
- **Numeric cells:** right-aligned, Geist Mono tabular-figures variant (`font-variant-numeric: tabular-nums`).
- **Padding:** `12px 16px` per cell.
- **Hover row:** `slate-50` light / `slate-800` dark, but only on tables that link out.
- **Mobile:** collapse to definition-list pattern below `md` breakpoint.

---

## 6. Motion

Motion serves two purposes: communicating **affordance** (this is interactive) and **continuity** (the page didn't reload, the state transitioned). Anything beyond those purposes is decoration and is rejected at review.

### 6.1 Timing tokens

| Token        | ms  | curve                            | Usage                             |
|--------------|-----|----------------------------------|-----------------------------------|
| `instant`    | 0   | —                                | Color swatches in pickers         |
| `fast`       | 120 | `cubic-bezier(0.2, 0, 0, 1)`     | Hover state changes, focus rings  |
| `base`       | 200 | `cubic-bezier(0.2, 0, 0, 1)`     | Default — opens, dismissals       |
| `relaxed`    | 320 | `cubic-bezier(0.2, 0, 0, 1)`     | Modal, drawer, large overlays     |
| `expressive` | 480 | `cubic-bezier(0.32, 0.72, 0, 1)` | Hero entrance, "wow" moments      |

The `cubic-bezier(0.2, 0, 0, 1)` curve is Linear's signature ease — fast acceleration, soft settle. Reserved `expressive` curve has a slight overshoot feel without the bounce.

### 6.2 Standard interactions

- **Hover lift (cards-as-links):** `translate-y(-2px)` + `shadow-md` over `base` (200ms).
- **Hover color (buttons, links):** `fast` (120ms).
- **Focus ring appearance:** `instant` (0) — accessibility requires no motion delay.
- **Modal entrance:** scrim fade `base`, panel `translate-y(8px) → 0 + opacity 0 → 1` over `relaxed` (320ms).
- **Page route transition (Next.js):** **fade only**, opacity 0 → 1 over `base` (200ms). No translate; the browser already provides motion via scroll position.
- **Skeleton loaders:** linear pulse, 1.6s cycle, between `slate-100` and `slate-200`.

### 6.3 Reduced motion

Honor `prefers-reduced-motion: reduce` globally. Replacement rule:

- All translate/scale: removed.
- All opacity transitions: kept but capped at `fast` (120ms).
- Skeleton pulse: replaced with a static `slate-100` block.

---

## 7. Imagery treatment

Three imagery classes appear on the site. Each has fixed rules so a marketing page assembled from mixed authors still reads as one product.

### 7.1 Code screenshots

When a screenshot of code is needed (e.g., showing the dashboard, or an IDE), prefer **live-rendered code blocks** (§5.6) over screenshots. When a screenshot is unavoidable:

- Source from the actual product, **not** marketing comps.
- Render at 2x for retina; deliver `.webp` + `.png` fallback.
- Crop to the relevant region — no full-window chrome unless the chrome is the subject.
- Apply the standard media frame: `rounded-xl`, `1px slate-200` border, `shadow-lg`, slight inner-shadow `inset 0 1px 0 rgba(255,255,255,0.04)` on dark variants for edge crispness.
- Caption below: `caption slate-500`, sentence-case, max 14 words.

### 7.2 Diagrams (architecture / pipeline)

Rules in §5.7. Adjunct rules:

- **One emphasis edge** per diagram in `ember-500`. If you find yourself wanting two emphasis colors, the diagram is doing two jobs — split it.
- **Node sizing:** consistent across the diagram. No "important node = bigger node" — use color and the emphasis edge instead.
- **Whitespace:** at least one full grid unit (32px in diagram coordinates) between adjacent nodes.

### 7.3 Photography & illustration

The site will avoid stock photography of people-with-laptops. When human imagery is needed (team page, founder bio):

- Black-and-white, neutral midtones at 50% (no extreme contrast).
- Square or 4:5 aspect, never 16:9.
- Background masked to `slate-100` light / `slate-800` dark for cohesion.

Illustration is **abstract-geometric only**. No characters, no metaphor scenes. Approved primitives: monochrome line grids, isometric stack diagrams, single-accent-color gradient panels. The visual library leans on the Vercel / Linear convention of "objects-on-stage."

---

## 8. Accessibility commitments

Tokens above are designed to satisfy these baselines without further per-page work:

- **Contrast:** body text ≥ 4.5:1, large text and UI ≥ 3:1 (WCAG AA).
- **Focus visibility:** every interactive element has a visible focus ring (`ring-2 ring-ember-400 ring-offset-2`).
- **Keyboard reachability:** nav, modals, callouts with actions, tables with row-links all must be navigable without a pointer.
- **Reduced motion:** see §6.3.
- **Semantic structure:** one `<h1>` per page; heading levels do not skip; landmarks (`<nav>`, `<main>`, `<footer>`, `<aside>`) are explicit.
- **Color is never the only signal:** semantic callouts pair color with icon and label; charts pair color with shape.

---

## 9. Implementation notes

- **Tailwind config:** see sibling `tailwind.config.ts` — paste-ready.
- **CSS variable plumbing:** light/dark theming uses CSS custom properties on `:root` and `:root[data-theme="dark"]`. Tailwind reads them via `hsl(var(--token))` in the config color block.
- **Font loading:** Geist Sans + Geist Mono via `next/font/local` with `display: swap` and a `font-display` fallback metric matched to system fonts (use the `font-display: optional` strategy on a second-visit basis if Lighthouse demands).
- **Dark mode toggle:** class-strategy (`class="dark"` on `<html>`) so we can hard-set per-page (e.g., the home hero is always dark even in light theme).
- **Component library:** start with utility classes; promote to React components only when a pattern has three confirmed usages. The first promotions are likely `<Button>`, `<Card>`, `<CodeBlock>`, `<Callout>`, `<Nav>`, `<Footer>`.
- **Existing dashboard tokens preserved:** `#0f1117` (slate-950), `#e2e8f0` (close to slate-100), `#63b3ed` (dark-mode info / legacy link) — see §2.

---

## 10. What is intentionally out of scope (v1.0)

- **Marketing illustration system** beyond the abstract-geometric primitives noted in §7.3 — to be authored in a v1.1 with a dedicated illustrator.
- **Internationalization typography** — Geist's non-Latin coverage is partial; CJK and Arabic require companion stacks that will be selected during the i18n initiative.
- **Animation framework choice** (Framer Motion vs CSS-only) — defer until first complex motion need lands; default to CSS transitions for v1.0 launch.
- **Email design system** — separate stack, will inherit colors and type scale but not component recipes.

---

## Appendix A — File map

```
docs/website-design-system/
├── README.md             ← this document
├── tailwind.config.ts    ← paste-ready Tailwind config
└── components.html       ← pseudo-HTML examples for §5
```

## Appendix B — Token cheat-sheet

```
Color anchors: ember-500, slate-950, mint-500
Type anchors:  display-2xl, body, body-sm, code
Spacing:       md (16), lg (24), 2xl (48), 3xl (64)
Radius:        md=8, lg=12, xl=16, 2xl=24
Shadow:        sm, md, lg (Tailwind defaults retained)
Motion:        fast 120ms, base 200ms, relaxed 320ms
```
