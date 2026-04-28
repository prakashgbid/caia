# Accessibility Lock

**Status**: Enforced by CI — build fails if violated
**Standard**: WCAG 2.1 Level AA (minimum)
**Enforcement**: `@pokerzeno/integrity-check` runs on every build's `out/` directory

This document defines accessibility requirements that apply to every PokerZeno site without exception. Requirements marked **[CI-ENFORCED]** will fail the build automatically. Requirements marked **[HUMAN-ENFORCED]** are validated during code review.

---

## Structural Requirements [CI-ENFORCED]

### Skip Navigation Link

Every page must have a skip-to-content link as the first focusable element.

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
```

CSS — visible only on focus (not hidden from keyboard users):
```css
.skip-link {
  position: absolute;
  top: -100%;
  left: 0;
}
.skip-link:focus {
  top: 0;
  z-index: 9999;
}
```

Do NOT use `display: none` or `visibility: hidden` — these hide the element from keyboard navigation entirely.

### Main Landmark

Every page must have exactly one `<main>` element with `id="main-content"`.

```html
<main id="main-content">
  <!-- page content -->
</main>
```

### Language Attribute

The `<html>` element must have a non-empty `lang` attribute.

```html
<html lang="en">       <!-- English -->
<html lang="es">       <!-- Spanish -->
<html lang="fr">       <!-- French -->
```

### Page Title

Every page must have a non-empty `<title>` element. The title must be descriptive — never just the site name.

```html
<!-- CORRECT -->
<title>Texas Hold'em Poker Rules — PokerZeno</title>

<!-- WRONG -->
<title>PokerZeno</title>
```

### Image Alt Text

Every `<img>` element must have an `alt` attribute.

```html
<!-- Informative image — describe the content -->
<img src="hand-rankings.png" alt="Poker hand rankings from royal flush to high card" />

<!-- Decorative image — empty alt (not missing, but empty) -->
<img src="card-suit-divider.svg" alt="" />
```

### Form Labels [CI-ENFORCED for inputs without aria-label]

Every `<input>`, `<select>`, and `<textarea>` must be labelled.

```html
<!-- Method 1: associated label -->
<label for="email">Email address</label>
<input type="email" id="email" />

<!-- Method 2: aria-label (for icon-only inputs) -->
<input type="search" aria-label="Search tips" />

<!-- Method 3: aria-labelledby -->
<input type="text" aria-labelledby="heading-id" />
```

---

## Visual Requirements [HUMAN-ENFORCED]

### Color Contrast

- Normal text (< 18px or < 14px bold): minimum 4.5:1 contrast ratio against background
- Large text (≥ 18px or ≥ 14px bold): minimum 3:1 contrast ratio
- UI components and graphical objects: minimum 3:1 against adjacent colors
- Check with: WebAIM Contrast Checker or browser DevTools color picker

Brand colors checked against white (#ffffff) and dark background (#1e1e1e):
- Royal purple #6d28d9 on white: **8.2:1** — passes AA and AAA
- Felt green #1a6b3c on white: **7.1:1** — passes AA and AAA
- Both fail on dark backgrounds — do not use these as text on dark backgrounds without verification

### Focus Indicators

All interactive elements must have a visible focus indicator. The default browser outline may be replaced but never removed without a replacement.

```css
/* REQUIRED — minimum acceptable focus style */
:focus-visible {
  outline: 3px solid #6d28d9;
  outline-offset: 2px;
  border-radius: 2px;
}

/* FORBIDDEN — removes focus indicator */
:focus { outline: none; }
*:focus { outline: 0; }
```

### Reduced Motion

All CSS animations and transitions must respect the user's motion preference.

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

---

## Interactive Components [HUMAN-ENFORCED]

### Tables

Data tables must include a `<thead>` with `scope` attributes on header cells.

```html
<table>
  <caption>Texas Hold'em Hand Rankings</caption>
  <thead>
    <tr>
      <th scope="col">Hand</th>
      <th scope="col">Description</th>
      <th scope="col">Probability</th>
    </tr>
  </thead>
  <tbody>
    <!-- rows -->
  </tbody>
</table>
```

### Modal Dialogs

- Must trap focus while open (Tab/Shift+Tab cycle within modal)
- Must close on Escape key
- Must return focus to the triggering element on close
- Must have `role="dialog"` and `aria-labelledby` pointing to modal title
- Background content must use `aria-hidden="true"` while modal is open

### Keyboard Navigation

All interactions achievable with a mouse must also be achievable with a keyboard:
- Links: Enter
- Buttons: Enter or Space
- Custom dropdowns: Arrow keys, Enter to select, Escape to close
- Tabs/accordion: Arrow keys to navigate, Enter/Space to activate

---

## Testing Checklist

Before marking any page as complete:

- [ ] Tab through the entire page with keyboard only — no traps, logical order
- [ ] Screen reader test (VoiceOver on Mac, NVDA on Windows) for key interactions
- [ ] Zoom browser to 200% — content still readable, no horizontal scroll
- [ ] Disable CSS — page content remains readable and logically ordered
- [ ] Run `pnpm run verify:integrity` — must pass
- [ ] Run `pnpm run test:e2e` — a11y.spec.ts must pass

---

## Enforcement Summary

| Requirement | Enforcement |
|-------------|-------------|
| Skip link | CI (integrity-check) |
| Main landmark | CI (integrity-check) |
| lang attribute | CI (integrity-check) |
| Page title | CI (integrity-check) |
| Image alt text | CI (integrity-check) |
| Color contrast | Human (code review) |
| Focus indicators | Human (code review) |
| Reduced motion | Human (code review) |
| Keyboard navigation | Human (manual test) |
| Tables with scope | Human (code review) |
