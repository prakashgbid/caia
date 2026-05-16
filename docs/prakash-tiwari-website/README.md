# prakash-tiwari.com — Design System v1.0

> **Status:** Phase-1 foundation
> **Last updated:** 2026-05-16
> **Scope:** Foundational tokens, components, and motion language for **prakash-tiwari.com** — Prakash Tiwari's personal/professional promotional site.
> **Out of scope (this phase):** Resume content, page layouts, copy. Sourced separately by the sitemap-content chain.

---

## 0. Philosophy

This is a personal site for **a professional, not a product**. The visual character is therefore deliberately quiet:

- **Quiet confidence over loud branding.** No logos. No monograms. No corporate decoration. The signature is the writing, the work, and the typography itself.
- **Editorial gravity.** Reference quality bar — Anthropic.com, Linear, Vercel, Stripe Press, Maggie Appleton, Brian Lovin. These sites all share a *publication* feel: serious about typography, generous with whitespace, restrained with color, opinionated about hierarchy.
- **Reads first, performs second.** A personal site is mostly a reading surface. Type renders well, contrast clears WCAG AA at minimum, motion never blocks comprehension.
- **Personal scale, not enterprise scale.** Containers are narrower than a product app. Whitespace is more generous. Components are fewer. No data tables, no dashboards, no dense control surfaces.
- **Strictly Prakash the professional.** The system has no visual cues tied to any organization, project, or employer. No reused org palettes. No reused org typefaces. This is a separate visual identity.

When in doubt: remove an element, increase the padding, drop a color, raise the line-height. Restraint is the brand.

---

## 1. Typography

### 1.1 Type system rationale

A personal site lives or dies on type. Three priorities drove the choice:

1. **Editorial serif for long-form** — essays, biography, writing samples need a typeface that signals thinking-at-length rather than scanning-quickly. A book-quality serif anchors the site's editorial gravity.
2. **Modern, neutral sans for UI + headings** — nav, buttons, captions, form-feeling chrome. The sans should be quiet enough to disappear into the page when it isn't doing hierarchy work.
3. **Workhorse mono for code** — code excerpts, technical writing, terminal-flavored quotes. Variable-width is not negotiable; ligatures are a personal-taste call (we enable them by default; can be turned off per-component).

### 1.2 Family selection

| Role | Family | Fallback stack | Why |
|---|---|---|---|
| **Sans (UI + headings)** | **Inter** (variable) | `-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif` | Inter is the modern, opinionated workhorse — wide x-height for legibility at small sizes, cleanly tabular numerals, a complete weight range (100–900) as a single variable file, free under SIL OFL. It is recognizable without being trendy and renders well across OS+browser combinations. |
| **Serif (long-form)** | **Source Serif 4** (variable) | `Iowan Old Style, "Iowan Old Style", "Apple Garamond", Baskerville, "Times New Roman", serif` | Source Serif 4 is a Pierre di Sciullo / Frank Grießhammer design with a book-quality color on the page, generous descenders, and a variable axis covering 200–900 + an optical-size axis. It carries long passages well and has a slight literary warmth that distinguishes the site from product-app sans-everywhere. Free under SIL OFL. |
| **Mono (code)** | **JetBrains Mono** (variable) | `"SF Mono", "Cascadia Code", "Fira Code", Menlo, Consolas, monospace` | Designed for code, distinguishable `0/O`, `1/l/I`, comfortable at 14–15px, ligatures available (default on for editorial code blocks, off for inline code). Free under SIL OFL. |

**Why not Geist, Söhne-likes, or IBM Plex?**

- *Geist* (Vercel) is excellent but increasingly visually associated with the Vercel/Next.js aesthetic — using it borrows that brand association, which is exactly what this site should avoid.
- *Söhne* (Klim) is gorgeous and is *the* default for the Anthropic/Linear aesthetic — but it's commercial and over-recognized in this exact reference cluster, so it would feel like imitation. Inter is the more honest neutral choice.
- *IBM Plex Sans/Serif* is institutional in feel; carries a faint corporate IBM cue that conflicts with the "personal, not organizational" rule.

**Loading strategy:**

- Self-host the variable fonts in `public/fonts/` (woff2 only, subsetted to Latin + Latin-Ext).
- Use `font-display: swap` to avoid invisible text during font load.
- Preload only the Inter file used above the fold; lazy-load the serif on routes that actually use long-form.
- Total font payload target: **< 90 KB** across all three families above-the-fold.

### 1.3 Type scale

A musical scale on a 1.250 (major third) ratio, anchored at 16px body. The display step (h1) is a quarter-octave above the next-up step to give hero blocks a visible jump.

| Token | Use | Size (rem / px) | Line-height | Weight | Tracking | Family |
|---|---|---|---|---|---|---|
| `display` | Hero headline only | 4.5rem / 72px | 1.05 | 500 | -0.025em | Sans |
| `h1` | Page title | 3rem / 48px | 1.10 | 500 | -0.02em | Sans |
| `h2` | Major section | 2.25rem / 36px | 1.15 | 500 | -0.015em | Sans |
| `h3` | Sub-section | 1.5rem / 24px | 1.25 | 500 | -0.01em | Sans |
| `h4` | Card title, minor heading | 1.25rem / 20px | 1.30 | 600 | -0.005em | Sans |
| `body-lg` | Lead paragraph, essay opener | 1.25rem / 20px | 1.65 | 400 | 0 | **Serif** |
| `body` | Default paragraph | 1rem / 16px | 1.7 | 400 | 0 | **Serif** for long-form, **Sans** for UI |
| `body-sans` | Default paragraph in UI chrome | 1rem / 16px | 1.55 | 400 | 0 | Sans |
| `small` | Captions, footnotes, meta | 0.875rem / 14px | 1.50 | 400 | 0 | Sans |
| `caption` | Image captions, metadata | 0.8125rem / 13px | 1.45 | 400 | 0.01em | Sans |
| `eyebrow` | Section overline ("Writing", "Projects") | 0.75rem / 12px | 1.40 | 600 | 0.10em (uppercase) | Sans |
| `code-inline` | Inline `<code>` | 0.9em (relative) | inherit | 400 | 0 | Mono |
| `code-block` | Block `<pre><code>` | 0.875rem / 14px | 1.7 | 400 | 0 | Mono |

**Tracking notes:**

- Headings above 24px get **negative tracking** (-0.005 to -0.025em). At display sizes, default letter-spacing reads loose; tightening it gives the type the controlled, edited quality the reference sites share.
- Body type uses default tracking (0). Letter-spacing on running text below 16px is a common mistake — don't.
- The `eyebrow` token is the only uppercase-by-default style. Use it sparingly: section labels, kicker lines. Never inside paragraphs.

**Weight notes:**

- Inter at 500 (Medium) is the standard heading weight — not 700 (Bold). Bold headings read as marketing; medium reads as editorial. This is the single most important typographic decision in the system.
- 600 (Semibold) is reserved for `h4`, `eyebrow`, and inline `<strong>` inside body.
- 400 (Regular) is the only body weight. No "light" (300) anywhere — light type fails on low-DPI screens and at small sizes.

**Long-form rule:**

- Whenever a passage exceeds ~3 sentences and the user is expected to *read*, use the serif (`body`/`body-lg`). Sans body is for UI surfaces (nav blurbs, card descriptions, form helper text) where the user is *scanning*.

### 1.4 Measure (line length)

- Long-form body sets at a **measure of 65-72 characters**. In our 1120-1280px container that means a constrained inner text column of `~640-720px`.
- UI body and card body can run wider (up to ~85ch) because they're scanned, not read.
- Never let a long-form paragraph run the full container width on desktop. The reading column is always narrower than the container.

---

## 2. Color palette

### 2.1 Palette rationale

A personal site needs **one ink color, one paper color, one accent color, and the bare minimum of semantic colors** — and that's it. Sites that look like Stripe Press, Anthropic, and Maggie Appleton's blog do this almost identically: they pick a warm off-white for paper, a near-black ink, and let exactly one accent do all the personality work.

**Warm vs. cool — we pick warm.** The reference cluster (Stripe Press, Anthropic, Maggie Appleton, Brian Lovin) leans into off-white paper tones (FAFAF7, F8F6F1, F5F2EB). Pure white (#FFFFFF) feels clinical and product-app. A 2-4% warm shift makes the page feel like a published page — and pairs better with serif body type. The neutral *grays* on top of paper are also tuned warm (very slight orange/yellow shift in the high range, neutralizing to cool in the lowest dark) — this is "warm gray," not "true neutral."

### 2.2 Light mode

| Token | Hex | Use |
|---|---|---|
| **Paper / surface** | | |
| `paper` | `#FAF8F4` | Page background. Warm off-white. |
| `paper-elevated` | `#FFFFFF` | Cards, modals — elevated surfaces sit *above* paper, slightly brighter. |
| `paper-sunken` | `#F2EFE9` | Footer, code blocks, sunken surfaces. |
| **Ink** | | |
| `ink` | `#13131A` | Primary text. Near-black with the faintest blue cast. **NOT** `#000000`. |
| `ink-muted` | `#4A4A55` | Secondary text. Captions, metadata. |
| `ink-subtle` | `#7A7A85` | Tertiary. Disabled, placeholders. |
| **Border** | | |
| `line` | `#E5E1D8` | Default border / divider. Warm. |
| `line-strong` | `#C8C2B4` | Emphasized divider, table rows. |
| **Accent** | | |
| `accent` | `#B14C26` | The single accent. Burnt sienna. Used for links, focus rings, key CTAs. |
| `accent-hover` | `#8F3B1B` | Hover/active state. |
| `accent-subtle` | `#FAEDE6` | Background tint for callouts, badges. |

**Why burnt sienna (`#B14C26`) for accent?**

Three reasons:
1. It's warm — it harmonizes with the paper, so the page doesn't fracture into "background tone + alien accent."
2. It's *not* blue — every product-app on the internet uses blue. Burnt sienna immediately signals editorial/personal rather than SaaS.
3. It's confident without being loud. At link-text size it reads as authoritative; at button size it reads as decisive. It does not scream.

A safe alternative is `#9C3D7A` (subdued plum) for a cooler personality, or `#2C5E4F` (forest) for a more reserved character. Pick one. Do not use multiple accents.

### 2.3 Dark mode

Dark mode is **not light-mode-with-inverted-colors**. It needs its own ink color (off-black, not pure black), its own paper (paper-dark is a very slightly *warm* dark gray, not a true black, to preserve the editorial character), and a re-tuned accent that survives on a dark background.

| Token | Hex | Use |
|---|---|---|
| **Paper / surface** | | |
| `paper` | `#14130F` | Page background. Warm near-black. |
| `paper-elevated` | `#1C1B16` | Cards on dark paper. |
| `paper-sunken` | `#0D0C0A` | Code blocks, deepest surfaces. |
| **Ink** | | |
| `ink` | `#F1EEE7` | Primary text. Warm off-white (matches paper-light). |
| `ink-muted` | `#A8A498` | Secondary text. |
| `ink-subtle` | `#6A6759` | Tertiary. |
| **Border** | | |
| `line` | `#2A2823` | Default divider. |
| `line-strong` | `#3F3C34` | Emphasized divider. |
| **Accent** | | |
| `accent` | `#D9794F` | Burnt sienna re-tuned for dark — lighter and more saturated to clear contrast. |
| `accent-hover` | `#E89370` | Hover/active. |
| `accent-subtle` | `#2F1F17` | Background tint for callouts. |

### 2.4 Semantic colors

Used sparingly — never as decoration, only for state communication. Same hue intent across light/dark, retuned for contrast.

| Token | Light | Dark | Use |
|---|---|---|---|
| `success` | `#2E7D5B` | `#5FB892` | Form success, completed states |
| `success-subtle` | `#E1F0E8` | `#162822` | Background tint |
| `warning` | `#A65D00` | `#E89B3D` | Form warning, caution |
| `warning-subtle` | `#FBEFD8` | `#2C200F` | Background tint |
| `error` | `#B43E3E` | `#E87878` | Form error, destructive action |
| `error-subtle` | `#F5E0E0` | `#2C1818` | Background tint |
| `info` | `#3A5DA8` | `#7DA0E5` | Informational callout |
| `info-subtle` | `#E0E8F5` | `#15202D` | Background tint |

### 2.5 Contrast & accessibility

- All ink-on-paper combinations clear **WCAG AA (4.5:1)** for normal text and **AAA (7:1)** wherever possible at body sizes.
- `accent` on `paper` clears **4.6:1** (light) and **5.1:1** (dark).
- `ink-muted` clears AA at body size; do not use for type smaller than 14px on `paper-elevated`.
- Never put `accent-subtle` text on `paper` — that combination is decorative-only.

### 2.6 The unused-color rule

Anything that isn't in this palette doesn't exist. No "just this once" colors. No client-suggested splashes of teal. If something needs to feel "different," reach for type weight or whitespace before reaching for a new color.

---

## 3. Spacing system

### 3.1 Scale

A **4-pixel base scale** with named tokens. The scale is non-linear at the top (jumps to give section padding real breathing room).

| Token | Pixels | rem | Common use |
|---|---|---|---|
| `space-0` | 0 | 0 | Reset |
| `space-px` | 1px | — | Hairline border |
| `space-0.5` | 2px | 0.125 | Tight icon-to-text |
| `space-1` | 4px | 0.25 | Minimum gap |
| `space-2` | 8px | 0.5 | Inline gap, chip padding-y |
| `space-3` | 12px | 0.75 | Tight stack gap |
| `space-4` | 16px | 1 | **Default gap (1×)** |
| `space-5` | 20px | 1.25 | Form-field vertical rhythm |
| `space-6` | 24px | 1.5 | Card padding |
| `space-8` | 32px | 2 | Section-internal gap |
| `space-10` | 40px | 2.5 | Card-to-card gap |
| `space-12` | 48px | 3 | Sub-section gap |
| `space-16` | 64px | 4 | Section gap (mobile) |
| `space-20` | 80px | 5 | Section gap (tablet) |
| `space-24` | 96px | 6 | Section gap (desktop default) |
| `space-32` | 128px | 8 | Major section gap |
| `space-40` | 160px | 10 | Hero-to-content gap |
| `space-48` | 192px | 12 | Reserve — large layout breaks |

### 3.2 Section padding conventions

The rhythm between sections is the single largest contributor to the "this feels personal/editorial, not crowded/SaaS" perception.

| Surface | Mobile | Tablet (≥768px) | Desktop (≥1024px) |
|---|---|---|---|
| Page top padding (below nav) | `space-16` | `space-24` | `space-32` |
| Between major sections | `space-16` | `space-20` | `space-24` |
| Hero block height padding | `space-20` top + `space-24` bottom | `space-32` top + `space-40` bottom | `space-40` top + `space-48` bottom |
| Card internal padding | `space-6` | `space-6` | `space-8` |
| Container side padding (gutter) | `space-5` (20px) | `space-8` (32px) | `space-12` (48px) |

**Generous-whitespace rule:** when in doubt between two adjacent spacing tokens, pick the larger one for vertical (section breaks) and the smaller one for horizontal (component-internal). Vertical rhythm is what gives the page editorial weight.

---

## 4. Layout

### 4.1 Container

| Token | Width | Use |
|---|---|---|
| `container-narrow` | `680px` | Long-form essays — measure of ~66ch with serif body |
| `container-prose` | `760px` | Default for content pages with mixed text + image |
| `container-default` | `1120px` | Standard page width — landing, project lists, about |
| `container-wide` | `1280px` | Maximum — only for grid-heavy pages |

**Default page width is `container-default` (1120px).** It's narrower than the typical SaaS site (1440px+) by design — it forces the eye to settle and gives the page a publication scale.

### 4.2 Grid

A **12-column grid** with a 24px gutter, used only on `container-default` and `container-wide`. Long-form pages don't use the grid — they use the narrower `container-narrow` / `container-prose` containers with no grid at all (single-column reading).

```
container-default (1120px)
├── 12 cols × 73.33px + 11 gutters × 24px
└── breakpoint-aware
```

### 4.3 Breakpoints

Mobile-first. Five breakpoints, named by intent rather than device.

| Token | Min-width | Intent |
|---|---|---|
| `xs` | 0 | Mobile (default, no media query) |
| `sm` | 640px | Large phone / small tablet portrait |
| `md` | 768px | Tablet portrait |
| `lg` | 1024px | Tablet landscape / small laptop |
| `xl` | 1280px | Desktop |
| `2xl` | 1536px | Large desktop (rare, sites should already be capped) |

We design and validate at `xs`, `md`, `lg` as the three primary breakpoints. `sm`, `xl`, `2xl` are tuning-only.

### 4.4 Whitespace conventions

- **Above-the-fold first impression:** hero block uses `space-40`+ top padding on desktop. The eye should encounter air, then a single confident headline, then more air, then maybe a sub-headline. Never a wall.
- **Stack gap default:** between siblings inside a section (e.g., heading → paragraph → button), default to `space-6` (24px). Override with `space-8` for "this is a beat" emphasis.
- **Section gap default:** between distinct sections, `space-24` (96px) on desktop, `space-16` (64px) on mobile.
- **Margin-left/right:** essay and prose content is always centered with `mx-auto` inside its container. Never asymmetric margins on a personal site.

---

## 5. Components

The component set is intentionally minimal — about a dozen pieces. The whole point of restraint is *not* having 50 components. If something needs visual emphasis, reach for type and whitespace before reaching for a new component.

### 5.1 Buttons

Four variants, three sizes. Buttons are **never** the dominant element on a page — they're the punctuation, not the headline.

| Variant | Use | Visual |
|---|---|---|
| `primary` | The single most important action on a page | Ink-on-paper inverse (dark fill, paper text). High-contrast. |
| `secondary` | Secondary action, paired with primary | Paper fill, ink border (1px `line-strong`), ink text |
| `ghost` | Tertiary, alongside other buttons | No fill, no border, ink text — relies on padding + hover state |
| `link` | Inline navigation, "Read more" | Looks like a link with underline — *is* a link semantically, styled to match buttons in pseudo-button contexts |

**Sizes:**
- `sm`: 32px height, `space-4` x-padding, 14px type
- `md` (default): 40px height, `space-5` x-padding, 14px type
- `lg`: 48px height, `space-6` x-padding, 15px type

**Notes:**
- Border radius: `radius-md` (6px). Pill buttons read as marketing/SaaS — avoid.
- Focus state: 2px `accent` ring offset by 2px from button edge.
- Disabled state: `ink-subtle` text on `paper-sunken`, no border.
- Loading state: text fades to 0.5 opacity, small mono "..." appears to the right. Never a spinner — spinners are product-app.

### 5.2 Cards

Two card variants only.

| Variant | Use |
|---|---|
| `card-default` | Project/writing entry — content list items |
| `card-quiet` | About/bio sub-blocks — softer separation |

**Anatomy:**
- Background: `paper-elevated` (default) or `paper` (quiet)
- Border: 1px `line` (default) or none (quiet, separated only by spacing)
- Radius: `radius-lg` (12px). Slightly rounded — never sharp, never pill.
- Padding: `space-6` on mobile, `space-8` on desktop.
- Shadow: **none.** Personal sites don't drop-shadow. Separation is by color and border only.
- Hover: borderless lift — 1px border softens to `line-strong`, text shifts to `accent`. No transform, no shadow drop.

### 5.3 Hero block

The hero is the single most important component on the home page. The pattern:

```
[eyebrow — optional, small uppercase label]
[display headline — 1 line on desktop, 2-3 max on mobile]
[lead paragraph — body-lg serif, max 2 sentences]
[primary CTA + secondary CTA, side by side]
[generous bottom padding — space-40+]
```

- Hero headline is **`display`** weight Inter Medium with tight tracking.
- Lead paragraph is **`body-lg` serif**. The mixed sans/serif here is the visual signature.
- Background is `paper` — no gradient, no image behind the headline. The image (headshot) sits to the side or below.

### 5.4 Top navigation

A single horizontal bar, sticky on scroll, ~64px tall.

```
[wordmark — text only, "Prakash Tiwari" in Inter Medium]   ............   [link] [link] [link] [theme toggle]
```

- No logo image. Text wordmark only.
- Links: `body-sans` 15px, `ink-muted` default, `ink` on hover, `accent` on active route.
- Sticky behavior: on scroll past hero, nav background fades from transparent to `paper` with a 1px bottom `line` border.
- Mobile: collapses to a hamburger at `md`. Hamburger opens a full-screen overlay (not a side drawer) — this is the personal-site convention.

### 5.5 Footer

Restrained, two-row.

```
Row 1: [contact link] [social links — restrained, text labels not icons]
Row 2: [© Prakash Tiwari · year] · [colophon link — fonts & build info]
```

- Background: `paper-sunken`.
- Padding: `space-12` vertical, container-width horizontal.
- All type: `small` (14px), `ink-muted`.
- Social links are **text labels** ("Twitter", "GitHub", "LinkedIn"), not icons. Icons would force a separate iconography system and clutter the visual restraint.

### 5.6 Image treatments

**Headshot:**
- Default rendering: rounded square (radius-lg, 12px), not a circle. Circles are for product avatars; squares feel more editorial.
- Aspect ratio: 4:5 portrait.
- Treatment: full color, no filter, no border. Optional 1% paper-tinted overlay in light mode to harmonize with paper background.
- Sizes: 240px on mobile, up to 320px on desktop.

**Project thumbnails:**
- Aspect ratio: 16:10.
- Border: 1px `line`, no shadow.
- Radius: `radius-md` (6px).
- On hover: 1px border darkens to `line-strong`. No scale, no overlay.

**Inline content images:**
- Always centered, never floated.
- Caption below in `caption` style (13px, ink-muted, slight tracking).

### 5.7 Pull quotes

```
[vertical accent rule — 2px wide, full height, color = accent]
[Quote text — body-lg serif, italic]
[— Attribution, small sans, ink-muted]
```

- No giant quotation marks. Personal sites don't need them.
- Indented from the body column by `space-6`.

### 5.8 Callouts

A bordered, tinted block for highlighting context, notes, or warnings. Three variants:

| Variant | Border-left | Background |
|---|---|---|
| `callout-note` | `accent` | `accent-subtle` |
| `callout-info` | `info` | `info-subtle` |
| `callout-warning` | `warning` | `warning-subtle` |

- 4px left border, no other borders.
- Padding: `space-4` (mobile), `space-5` (desktop).
- Internal type is `body-sans` 15px (slightly smaller than running body) to signal "aside."

### 5.9 Code blocks

```
[language label — small sans, ink-muted, top-right of block]
[code — JetBrains Mono 14px, body line-height]
```

- Background: `paper-sunken`.
- Border: 1px `line`.
- Padding: `space-4` (mobile), `space-5` (desktop).
- Radius: `radius-md`.
- Syntax highlighting: minimal palette — `ink` for default, `ink-muted` for comments, `accent` for keywords. **Three colors maximum** in syntax theme. Rainbow themes are product-app.
- Inline code: paper-sunken background, no border, `space-1` horizontal padding, `radius-sm` (4px).

### 5.10 List styling

- Unordered: `•` marker, ink-muted, `space-2` gap from text, hanging indent so wrapped lines align under the first character of list text (not under the bullet).
- Ordered: numerals in Inter tabular-numerals, ink-muted, same hanging indent.
- Long-form lists (inside essays) get `space-3` between items. UI lists get `space-2`.

### 5.11 Link styling

**This is the single most important micro-decision in the system.**

In long-form text, links should be obvious but not jarring. The rule:

- **Color:** `accent` (burnt sienna).
- **Underline:** present by default, but **thin** (1px) and **offset** (3px below baseline). Never the default 2-3px-thick browser underline; never a heavy hover underline.
- **On hover:** underline thickens to 2px and shifts color to `accent-hover`. Text color does not change on hover.
- **External links:** no auto-appended icon. The accent color is enough signal.
- **Visited links:** no different color. Visited-state coloring is a Wikipedia/legacy convention that breaks editorial consistency.

In nav and chrome contexts, links are `ink-muted` with no underline; underline appears on hover.

```css
/* The link rule, in one place */
a {
  color: var(--accent);
  text-decoration-line: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 3px;
  transition: text-decoration-thickness 120ms ease, color 120ms ease;
}
a:hover {
  color: var(--accent-hover);
  text-decoration-thickness: 2px;
}
```

### 5.12 Radius scale

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 4px | Inline code, small chips |
| `radius-md` | 6px | Buttons, inputs, project thumbnails |
| `radius-lg` | 12px | Cards, headshot |
| `radius-xl` | 20px | Reserve — only if needed for a specific decorative element |
| `radius-full` | 9999px | **Avatars only.** Never on buttons or cards. |

---

## 6. Motion

Personal sites should feel *paced*, not *animated*. The motion language is built on three principles:

1. **Subtle.** Most transitions are sub-200ms and only affect color, opacity, or 1-2px positional shifts. Nothing rotates. Nothing scales beyond 1.02. Nothing slides more than 8px.
2. **Functional.** Motion confirms state changes (hover, focus, route transition) — it does not entertain.
3. **Reduced-motion respectful.** Every animation has a `prefers-reduced-motion: reduce` fallback that drops to a 0ms duration.

### 6.1 Easing tokens

| Token | Curve | Use |
|---|---|---|
| `ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | UI state changes (most things) |
| `ease-out` | `cubic-bezier(0, 0, 0.2, 1)` | Enter transitions (modal open, drawer in) |
| `ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exit transitions (modal close, drawer out) |
| `ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | Hero / above-fold reveal — slightly more pronounced |

### 6.2 Duration tokens

| Token | ms | Use |
|---|---|---|
| `duration-fast` | 100 | Color, opacity micro-changes |
| `duration-default` | 200 | Hover states, focus rings, button presses |
| `duration-moderate` | 320 | Route transitions, modal enter |
| `duration-slow` | 500 | Hero reveal, scroll-triggered fades |
| `duration-deliberate` | 800 | Reserve — only for first-time-load hero treatment |

### 6.3 Hover state inventory

The complete list of hover effects allowed in the system:

| Element | Hover effect |
|---|---|
| Link | Underline thickens 1px → 2px, color shifts `accent` → `accent-hover` |
| Button (primary) | Background darkens 8% (no scale, no shadow) |
| Button (secondary) | Border darkens `line-strong` → `ink-muted`, text optional shift |
| Button (ghost) | Background fills with `paper-sunken` |
| Card | Border softens `line` → `line-strong`, optional title color → `accent` |
| Image thumbnail | Border darkens, optional 1% paper overlay lifts |
| Nav link | Color shifts `ink-muted` → `ink`; active route stays `accent` |
| Theme toggle | Icon rotates 15° max, swap on click |

**Not allowed:**
- Scale on hover (e.g., `transform: scale(1.05)` on cards)
- Shadow drops on hover
- Color sweeps / gradient shifts
- Box-shadow glows
- Animated borders (dashes, gradients, etc.)
- Cursor follows / parallax on cursor
- Magnetic buttons

### 6.4 Scroll behavior

- Smooth scroll on `html` (overridable per `prefers-reduced-motion`).
- Scroll-triggered fade-ins are allowed for above-the-fold-only blocks (hero on home, hero on essay), but never for content lists below the fold (they should already be visible).
- No parallax. No scroll-jacking.

### 6.5 Reduced-motion fallback

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This block is non-negotiable and ships in every stylesheet at the top.

---

## 7. Imagery treatment

### 7.1 Headshot

The single most important image on the site.

- **Framing:** chest-up, slight tilt allowed, eyes meeting camera.
- **Background:** neutral — gradient, single-color seamless, or quiet contextual environment. **Never a busy bookshelf or office.**
- **Crop:** 4:5 vertical, with eye-line at ~38% from top (rule-of-thirds upper).
- **Treatment:** full color, no filter, no black-and-white. Color brings warmth; B&W is a corporate-bio cliché.
- **Container:** `radius-lg` rounded square, 240-320px depending on context. No drop shadow, no border. Optional 1% `paper` tint overlay in light mode (zero overlay in dark mode).
- **Alt text:** descriptive — "Portrait of Prakash Tiwari, looking toward the camera." Not "headshot.jpg."

### 7.2 Project thumbnails

- **Aspect ratio:** 16:10 (slightly wider than 16:9 — feels more editorial, less video-thumbnail-y).
- **Treatment:** as-is, no overlay, no filter. The work speaks.
- **Container:** `radius-md`, 1px `line` border. No shadow.
- **Hover:** border darkens. No zoom.

### 7.3 Iconography

**Pick one style and never mix.** This system uses **line icons, 1.5px stroke, rounded caps**.

- Library: **Lucide** (`lucide-react`) — it's the post-Feather line-icon standard, MIT, well-maintained, comprehensive.
- Why not filled icons? Filled icons read as product-UI (Material, iOS). Line icons read as editorial (newspaper iconography, infographic style).
- Why 1.5px stroke (not 2px)? 2px is the default and feels heavy-handed at 16px sizes; 1.5px is the personal-site sweet spot.
- Color: always `ink-muted` by default, never `accent` unless explicitly indicating state.
- Size scale: 16px (inline with text), 20px (button leading), 24px (standalone UI).

**Allowed icon uses:**
- Theme toggle (sun / moon)
- External link indicator inside `<a target="_blank">` *only when needed for accessibility* — not on every external link
- Form input affordances (search, dismiss)
- Nav hamburger (mobile only)

**Disallowed:**
- Icons next to every nav item
- Icons inside body paragraphs
- "Feature" icons (clock, lightbulb, gear) as decoration in card lists — these are SaaS-marketing tropes

### 7.4 Photography vs. illustration

**Stance: photography over illustration.** A personal site is about a real human. Custom illustration introduces a separate visual style that competes with the typographic identity — and risks looking like a product onboarding page.

- Headshot: photography.
- Inline content imagery (essay illustrations, project screenshots): photography or in-context screenshot.
- Decorative spot illustration: **none** unless commissioned as a one-off editorial moment for a specific essay (and then it lives in that essay, not in the design system).
- Iconography: line icons only, no illustrated icons.

### 7.5 Image performance

- All images served as `<picture>` with AVIF + WebP fallback to JPEG.
- All images have explicit `width`/`height` attributes (prevent CLS).
- Above-the-fold images use `loading="eager"` + `fetchpriority="high"`; below-the-fold images use `loading="lazy"`.
- The headshot is the only image preloaded in `<head>`.

---

## 8. Accessibility commitments

- **WCAG AA** at minimum across all type / interactive combinations; AAA for body text.
- **Keyboard navigation** complete — every interactive element reachable, every focus state visible (`accent` 2px ring offset 2px).
- **Skip-to-content** link inside `<header>`, visible on focus.
- **Heading hierarchy** strict — one `<h1>` per page, no skipped levels.
- **Reduced motion** honored as Section 6.5.
- **Color is never the only signal** — links carry both underline + color; errors carry both text + color; etc.
- **Touch target minimum 44×44px** for any interactive element on mobile.

---

## 9. What's *not* in the system (deliberate)

Documenting the absences is half the system. None of the following exist in the prakash-tiwari.com design system:

- Logos, monograms, "PT" wordmarks
- Gradients (anywhere — background, button, text, illustration)
- Drop shadows (cards, buttons, modals)
- Glassmorphism / frosted glass / backdrop blur
- Neumorphism, embossed elements, beveled surfaces
- Multiple accent colors / "feature highlight" palettes
- Decorative iconography in content (lightbulbs, clocks, rocket emojis)
- Skeleton loaders (this is a content site, not a data app)
- Modal popups for newsletter / "subscribe" cookies
- Animated number counters, typewriter effects on headlines, scroll-jacking
- Background patterns (dots, grids, noise textures behind hero)
- Floating action buttons
- Tabs in primary content (they break linear reading)
- Marquee bars / scrolling testimonials
- Stock 3D rendered objects, AI-generated decorative imagery
- Confetti / micro-celebrations on form submit

If a future change-request reaches for any of these, the answer is "no — increase the type weight, the whitespace, or the contrast instead."

---

## 10. File map

This phase ships three files in `docs/prakash-tiwari-website/`:

- `README.md` — this document (spec)
- `tailwind.config.ts` — token implementation, ready to paste into a Next.js + Tailwind app
- `components.html` — pseudo-HTML examples of the system in action (button, card, hero, nav, footer, callout)

Subsequent chains layer on:

- Sitemap + content plan (separate chain)
- Page-level designs (separate chain)
- Real-content integration (separate chain)

---

## 11. Versioning

This is **v1.0** of the design system. Changes should land via PRs that:

1. Update this README with a "Changes from v1.0" section at top.
2. Bump the version in the file header.
3. Update `tailwind.config.ts` tokens in lockstep.
4. Keep `components.html` exemplary — if a new component lands, add it here.

Breaking token changes (renaming `space-6`, retiring `accent`) get a major version bump. Adding tokens or component variants is minor. Adjusting hex values inside an existing token is a patch.

---

*End of spec.*
