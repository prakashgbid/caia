# PokerZeno Brand Lock

**Status**: Human-enforced — reviewed during code review and site setup
**Applies to**: All PokerZeno network sites (pokerzeno, roulettecommunity, and all future sites)
**Site-level overrides**: Documented in each site's `SITE_BRAND_LOCK.md`

This document defines the shared brand foundation. Sites may override accent colors and site name but must maintain the core structure, typography system, voice, and accessibility requirements.

---

## Color Palette

### Core Brand Colors

| Token | Hex | Use |
|-------|-----|-----|
| `brand-purple` | `#6d28d9` | Primary CTAs, links, active states, logo |
| `felt-green` | `#1a6b3c` | Game table backgrounds, success states, "live" indicators |
| `card-white` | `#fafafa` | Card surfaces, modal backgrounds, input backgrounds |
| `deep-black` | `#0f0f0f` | Primary text on light backgrounds, footer |
| `slate-mid` | `#64748b` | Secondary text, captions, metadata |
| `border-light` | `#e2e8f0` | Dividers, card borders, input borders |

### Extended Palette

| Token | Hex | Use |
|-------|-----|-----|
| `purple-dark` | `#5b21b6` | Hover state for brand-purple |
| `purple-light` | `#ede9fe` | Tinted backgrounds, tag pills, highlight blocks |
| `green-dark` | `#145a32` | Hover state for felt-green |
| `green-light` | `#dcfce7` | Success banners, correct answer highlights |
| `danger-red` | `#dc2626` | Errors, wrong answers, destructive actions |
| `warning-amber` | `#d97706` | Caution states, "coming soon" badges |

### Dark Mode

All sites must support dark mode via `prefers-color-scheme: dark`. Token mappings in dark mode:
- Background: `#0f1117` (not pure black — easier on eyes)
- Card surface: `#1a1d27`
- Primary text: `#f1f5f9`
- Secondary text: `#94a3b8`
- Brand purple: same (`#6d28d9`) — high contrast on dark bg
- Felt green: use `#22c55e` in dark mode (lighter for contrast)

Tailwind implementation: `darkMode: 'media'` in `tailwind.config.ts`. Use `dark:` prefix classes throughout.

### Do Not Use

- Pure `#ffffff` for large background areas — use `card-white` (`#fafafa`) for warmth
- Pure `#000000` for text — use `deep-black` (`#0f0f0f`)
- Red as a primary CTA — red is reserved for error/danger states only
- Rainbow gradients — if gradients are used, limit to two brand colors

---

## Typography

### Type Scale

| Role | Family | Size | Weight | Notes |
|------|--------|------|--------|-------|
| Display heading | Georgia, serif | 2.25rem (36px) | 700 | H1 on article pages |
| Section heading | Georgia, serif | 1.5rem (24px) | 700 | H2 |
| Sub-heading | system-ui, sans-serif | 1.25rem (20px) | 600 | H3, card titles |
| Body | system-ui, sans-serif | 1rem (16px) | 400 | All body text |
| Small / Meta | system-ui, sans-serif | 0.875rem (14px) | 400 | Tags, dates, captions |
| Code | `ui-monospace, monospace` | 0.875rem (14px) | 400 | Inline code, probability tables |

Georgia is used for display and section headings to evoke the classic, serious feel of a well-studied card player. System fonts for body ensure fast rendering with no font fetch.

### Line Height

- Display headings: `line-height: 1.2`
- Body text: `line-height: 1.75` (generous for readability in long-form strategy articles)
- Captions / meta: `line-height: 1.4`

### Measure (Line Length)

Body text columns should be 60-75 characters wide (approximately `max-width: 65ch`). Never let body text span the full viewport width on desktop.

---

## Spacing System

Base unit: **8px** (0.5rem). All spacing values are multiples of 8.

| Token | Value | Common use |
|-------|-------|------------|
| `space-1` | 8px | Internal padding for small components (tags, badges) |
| `space-2` | 16px | Standard component padding, gap between items |
| `space-3` | 24px | Section padding, card padding |
| `space-4` | 32px | Between sections |
| `space-6` | 48px | Major section breaks |
| `space-8` | 64px | Hero sections, large gaps |

Never use arbitrary pixel values. If a design requires 12px, step up to 16px or down to 8px.

---

## Iconography

### Card Suits

The four card suits are used as core visual elements across all sites:

| Suit | Unicode | Color |
|------|---------|-------|
| ♠ Spade | U+2660 | Black (`#0f0f0f`) |
| ♥ Heart | U+2665 | Red (`#dc2626`) |
| ♦ Diamond | U+2666 | Red (`#dc2626`) |
| ♣ Club | U+2663 | Black (`#0f0f0f`) |

Used in: favicon (rounded rect + suit character), logo mark, section dividers, bullet points in tip lists.

### Logo Pattern

```
[rounded-rect SVG background in brand-purple] + [primary suit character in card-white]
```

Example SVG structure (poker site uses ♠):
```svg
<svg width="48" height="48" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="10" fill="#6d28d9"/>
  <text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle"
        fill="#fafafa" font-size="28">♠</text>
</svg>
```

For roulette-themed sites: use a roulette wheel emoji or ◉ (circle with ring) instead of a card suit.

### General Icons

Use `lucide-react` for UI icons (chevrons, close, search, etc.). Lucide is already included in `@pokerzeno/ui`. Never import a second icon library.

All icons used as standalone clickable elements must have `aria-label` or be accompanied by visible text.

---

## Voice and Tone

### Principles

**Calm and analytical.** PokerZeno is the serious player's companion. The voice is knowledgeable, measured, and respects the reader's intelligence.

**Educational, not promotional.** Articles teach strategy and concepts. Headlines state what the reader will learn, not what they'll win.

**Never gambling-promotional.** We do not:
- Promise winnings or imply guaranteed profits ("Beat the house every time")
- Use high-urgency pressure language ("Play NOW — limited bonus!")
- Make claims about luck or prediction
- Use casino marketing tropes (flames, "$$$", "JACKPOT")

### Examples

| Avoid | Use instead |
|-------|-------------|
| "Crush your opponents with this secret tip" | "Position play: using table position to your advantage" |
| "Win more money at poker today" | "How pot odds affect calling decisions" |
| "The trick casinos don't want you to know" | "Understanding the house edge in roulette" |
| "You're leaving money on the table" | "Three common mistakes in tournament late-stage play" |

### Headlines

- Declarative or instructional: "How to read poker tells" / "The Fibonacci betting system explained"
- Questions are acceptable if genuine: "When should you fold top pair?"
- Avoid clickbait superlatives: "best", "ultimate", "insane", "mind-blowing"

---

## Responsible Gambling

Every site in the network must include:
1. A footer link to a responsible gambling resource (e.g., BeGambleAware.org, NCPG)
2. A brief disclaimer on pages discussing strategy: "Card games involve risk. Play responsibly."

This is not negotiable. It is both ethically required and legally prudent in most jurisdictions.
