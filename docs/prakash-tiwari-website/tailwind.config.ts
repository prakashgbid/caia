/**
 * prakash-tiwari.com — Tailwind configuration v1.0
 *
 * Implements the design tokens defined in ./README.md:
 *   - Typography (Inter sans, Source Serif 4 long-form, JetBrains Mono code)
 *   - Color palette (warm paper, near-black ink, single burnt-sienna accent)
 *   - Spacing scale (4px base, named tokens)
 *   - Layout (1120px default container, 12-col grid, 5 breakpoints)
 *   - Motion (sub-200ms defaults, prefers-reduced-motion respected)
 *
 * Drop-in for a Next.js + Tailwind 3.x app. Assumes:
 *   - Self-hosted variable fonts under /public/fonts/{inter,source-serif-4,jetbrains-mono}.woff2
 *   - CSS variables for paper/ink/accent are emitted via a globals.css layer (see README §2)
 *   - `darkMode: 'class'` strategy (toggle a `.dark` class on <html>)
 *
 * The colors are also exposed as CSS variables so the dark-mode tuning lives
 * in one place (globals.css) rather than being duplicated here. The Tailwind
 * tokens point at the CSS variables, which means `bg-paper` resolves to the
 * right tone in either mode automatically.
 */

import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx,mdx}',
    './pages/**/*.{ts,tsx,mdx}',
    './components/**/*.{ts,tsx,mdx}',
    './content/**/*.{md,mdx}',
  ],
  darkMode: 'class',
  theme: {
    // -------------------------------------------------------------------
    // Breakpoints (mobile-first; named by intent, not by device)
    // -------------------------------------------------------------------
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },

    // -------------------------------------------------------------------
    // Container — narrower than typical SaaS by design (publication scale)
    // -------------------------------------------------------------------
    container: {
      center: true,
      padding: {
        DEFAULT: '1.25rem', // space-5  (20px) mobile gutter
        md: '2rem',         // space-8  (32px) tablet gutter
        lg: '3rem',         // space-12 (48px) desktop gutter
      },
      screens: {
        sm: '640px',
        md: '760px',
        lg: '1024px',
        xl: '1120px',       // default page width
        '2xl': '1280px',    // grid-heavy pages only
      },
    },

    // -------------------------------------------------------------------
    // Extend — we replace many defaults rather than purely extend, because
    // the system is intentionally smaller than Tailwind's out-of-the-box.
    // -------------------------------------------------------------------
    extend: {
      // ---------------------------------------------------------------
      // Color tokens
      // Hex values are the SOURCE OF TRUTH. CSS variables in globals.css
      // are derived from these. Light values are the defaults; .dark class
      // on <html> swaps the CSS variables to dark-mode values.
      // ---------------------------------------------------------------
      colors: {
        // Surfaces (paper)
        paper: {
          DEFAULT: 'var(--color-paper)',         // light: #FAF8F4 | dark: #14130F
          elevated: 'var(--color-paper-elevated)', // light: #FFFFFF | dark: #1C1B16
          sunken: 'var(--color-paper-sunken)',     // light: #F2EFE9 | dark: #0D0C0A
        },
        // Ink (text)
        ink: {
          DEFAULT: 'var(--color-ink)',           // light: #13131A | dark: #F1EEE7
          muted: 'var(--color-ink-muted)',       // light: #4A4A55 | dark: #A8A498
          subtle: 'var(--color-ink-subtle)',     // light: #7A7A85 | dark: #6A6759
        },
        // Borders
        line: {
          DEFAULT: 'var(--color-line)',          // light: #E5E1D8 | dark: #2A2823
          strong: 'var(--color-line-strong)',    // light: #C8C2B4 | dark: #3F3C34
        },
        // Accent — the one expressive color (burnt sienna)
        accent: {
          DEFAULT: 'var(--color-accent)',        // light: #B14C26 | dark: #D9794F
          hover: 'var(--color-accent-hover)',    // light: #8F3B1B | dark: #E89370
          subtle: 'var(--color-accent-subtle)',  // light: #FAEDE6 | dark: #2F1F17
        },
        // Semantic — used sparingly
        success: {
          DEFAULT: 'var(--color-success)',
          subtle: 'var(--color-success-subtle)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          subtle: 'var(--color-warning-subtle)',
        },
        error: {
          DEFAULT: 'var(--color-error)',
          subtle: 'var(--color-error-subtle)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          subtle: 'var(--color-info-subtle)',
        },
      },

      // ---------------------------------------------------------------
      // Typography — three families, opinionated stack
      // ---------------------------------------------------------------
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        serif: [
          'Source Serif 4',
          'Iowan Old Style',
          'Apple Garamond',
          'Baskerville',
          'Times New Roman',
          'serif',
        ],
        mono: [
          'JetBrains Mono',
          'SF Mono',
          'Cascadia Code',
          'Fira Code',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },

      // ---------------------------------------------------------------
      // Type scale — major-third (1.25) with a quarter-octave display jump
      // Tuple: [fontSize, { lineHeight, letterSpacing, fontWeight }]
      // ---------------------------------------------------------------
      fontSize: {
        // Headings (sans, Medium 500, negative tracking above 24px)
        display:   ['4.5rem',   { lineHeight: '1.05', letterSpacing: '-0.025em', fontWeight: '500' }], // 72px hero
        h1:        ['3rem',     { lineHeight: '1.10', letterSpacing: '-0.020em', fontWeight: '500' }], // 48px page title
        h2:        ['2.25rem',  { lineHeight: '1.15', letterSpacing: '-0.015em', fontWeight: '500' }], // 36px section
        h3:        ['1.5rem',   { lineHeight: '1.25', letterSpacing: '-0.010em', fontWeight: '500' }], // 24px sub-section
        h4:        ['1.25rem',  { lineHeight: '1.30', letterSpacing: '-0.005em', fontWeight: '600' }], // 20px card title

        // Body — note: serif vs sans is chosen per-component (long-form vs UI)
        'body-lg': ['1.25rem',  { lineHeight: '1.65', letterSpacing: '0',        fontWeight: '400' }], // 20px lead
        body:      ['1rem',     { lineHeight: '1.70', letterSpacing: '0',        fontWeight: '400' }], // 16px paragraph
        'body-sans': ['1rem',   { lineHeight: '1.55', letterSpacing: '0',        fontWeight: '400' }], // 16px UI body

        // Small / chrome
        small:     ['0.875rem', { lineHeight: '1.50', letterSpacing: '0',        fontWeight: '400' }], // 14px
        caption:   ['0.8125rem',{ lineHeight: '1.45', letterSpacing: '0.010em',  fontWeight: '400' }], // 13px
        eyebrow:   ['0.75rem',  { lineHeight: '1.40', letterSpacing: '0.100em',  fontWeight: '600' }], // 12px uppercase

        // Code
        'code-block':  ['0.875rem', { lineHeight: '1.70', letterSpacing: '0', fontWeight: '400' }],   // 14px
        // (Inline code sets size relatively via CSS — keep it out of the Tailwind ramp)
      },

      // ---------------------------------------------------------------
      // Font-weight aliases — restrict the palette
      // The system uses only 400, 500, 600. 700+ is reserved.
      // ---------------------------------------------------------------
      fontWeight: {
        regular: '400',
        medium: '500',
        semibold: '600',
      },

      // ---------------------------------------------------------------
      // Letter-spacing — explicit tokens for repeating use cases
      // ---------------------------------------------------------------
      letterSpacing: {
        tightest: '-0.025em',
        tighter:  '-0.020em',
        tight:    '-0.015em',
        snug:     '-0.010em',
        normal:   '0',
        wide:     '0.010em',
        wider:    '0.050em',
        eyebrow:  '0.100em',  // uppercase section labels
      },

      // ---------------------------------------------------------------
      // Spacing — 4px base scale (extends Tailwind's defaults with named
      // section-level tokens at the top end)
      // ---------------------------------------------------------------
      spacing: {
        // Top-level rhythm tokens (used for section padding)
        'section-mobile':    '4rem',   // 64px  — between sections, mobile
        'section-tablet':    '5rem',   // 80px  — between sections, tablet
        'section-desktop':   '6rem',   // 96px  — between sections, desktop
        'section-major':     '8rem',   // 128px — major section break
        'hero-bottom':       '12rem',  // 192px — hero-to-content reserve
      },

      // ---------------------------------------------------------------
      // Max-width — container variants for content density
      // ---------------------------------------------------------------
      maxWidth: {
        narrow:  '680px',   // long-form essay measure
        prose:   '760px',   // mixed text + image content
        default: '1120px',  // standard page
        wide:    '1280px',  // grid-heavy max
      },

      // ---------------------------------------------------------------
      // Border-radius — opinionated scale, full reserved for avatars
      // ---------------------------------------------------------------
      borderRadius: {
        none: '0',
        sm:   '4px',     // inline code, chips
        DEFAULT: '6px',  // alias for `md` so `rounded` reads naturally
        md:   '6px',     // buttons, inputs, project thumbnails
        lg:   '12px',    // cards, headshot
        xl:   '20px',    // reserve
        full: '9999px',  // avatars ONLY
      },

      // ---------------------------------------------------------------
      // Box-shadow — explicitly NONE for the system, except focus rings
      // The system uses borders for separation, not shadows.
      // ---------------------------------------------------------------
      boxShadow: {
        none: 'none',
        // Focus ring (used by buttons, inputs, links)
        focus: '0 0 0 2px var(--color-paper), 0 0 0 4px var(--color-accent)',
      },

      // ---------------------------------------------------------------
      // Motion — subtle by default; fast for state changes, moderate for routes
      // ---------------------------------------------------------------
      transitionTimingFunction: {
        DEFAULT:    'cubic-bezier(0.4, 0, 0.2, 1)',
        out:        'cubic-bezier(0, 0, 0.2, 1)',
        in:         'cubic-bezier(0.4, 0, 1, 1)',
        emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      transitionDuration: {
        fast:        '100ms',
        DEFAULT:     '200ms',
        moderate:    '320ms',
        slow:        '500ms',
        deliberate:  '800ms',
      },
      transitionProperty: {
        // Constrained list — never transition `all`
        colors: 'background-color, border-color, color, fill, stroke, text-decoration-color',
        opacity: 'opacity',
        spacing: 'margin, padding',
        decoration: 'text-decoration-thickness, text-underline-offset',
      },

      // ---------------------------------------------------------------
      // Typography plugin overrides (@tailwindcss/typography)
      // Configures `prose` for long-form essays with serif body
      // ---------------------------------------------------------------
      typography: ({ theme }: { theme: (key: string) => string }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body':         'var(--color-ink)',
            '--tw-prose-headings':     'var(--color-ink)',
            '--tw-prose-lead':         'var(--color-ink-muted)',
            '--tw-prose-links':        'var(--color-accent)',
            '--tw-prose-bold':         'var(--color-ink)',
            '--tw-prose-counters':     'var(--color-ink-muted)',
            '--tw-prose-bullets':      'var(--color-ink-muted)',
            '--tw-prose-hr':           'var(--color-line)',
            '--tw-prose-quotes':       'var(--color-ink)',
            '--tw-prose-quote-borders':'var(--color-accent)',
            '--tw-prose-captions':     'var(--color-ink-muted)',
            '--tw-prose-code':         'var(--color-ink)',
            '--tw-prose-pre-code':     'var(--color-ink)',
            '--tw-prose-pre-bg':       'var(--color-paper-sunken)',
            '--tw-prose-th-borders':   'var(--color-line)',
            '--tw-prose-td-borders':   'var(--color-line)',

            fontFamily: theme('fontFamily.serif').toString(),
            fontSize: '1rem',
            lineHeight: '1.7',
            maxWidth: '65ch',

            // Headings inside prose use sans (not serif)
            'h1, h2, h3, h4': {
              fontFamily: theme('fontFamily.sans').toString(),
              fontWeight: '500',
            },

            // Link rule (matches §5.11)
            a: {
              textDecorationLine: 'underline',
              textDecorationThickness: '1px',
              textUnderlineOffset: '3px',
              fontWeight: 'inherit',
              transition: 'text-decoration-thickness 120ms ease, color 120ms ease',
            },
            'a:hover': {
              textDecorationThickness: '2px',
              color: 'var(--color-accent-hover)',
            },

            // Inline code
            code: {
              fontFamily: theme('fontFamily.mono').toString(),
              backgroundColor: 'var(--color-paper-sunken)',
              padding: '0.125em 0.375em',
              borderRadius: '4px',
              fontSize: '0.9em',
              fontWeight: '400',
            },
            'code::before': { content: '""' },
            'code::after':  { content: '""' },

            // Pull-quote
            blockquote: {
              fontStyle: 'italic',
              fontSize: '1.25rem',
              lineHeight: '1.65',
              borderLeftWidth: '2px',
              borderLeftColor: 'var(--color-accent)',
              paddingLeft: '1.5rem',
              quotes: 'none',
            },
            'blockquote p:first-of-type::before': { content: '""' },
            'blockquote p:last-of-type::after':   { content: '""' },
          },
        },
      }),
    },
  },

  // Plugins
  plugins: [
    // require('@tailwindcss/typography'),
    // ^ enable after `pnpm add -D @tailwindcss/typography` — see README §10
  ],
};

export default config;

/* ---------------------------------------------------------------------
 * globals.css companion — paste at the top of app/globals.css
 * ---------------------------------------------------------------------
 *
 * @tailwind base;
 * @tailwind components;
 * @tailwind utilities;
 *
 * @layer base {
 *   :root {
 *     // Surfaces
 *     --color-paper:          #FAF8F4;
 *     --color-paper-elevated: #FFFFFF;
 *     --color-paper-sunken:   #F2EFE9;
 *     // Ink
 *     --color-ink:        #13131A;
 *     --color-ink-muted:  #4A4A55;
 *     --color-ink-subtle: #7A7A85;
 *     // Lines
 *     --color-line:        #E5E1D8;
 *     --color-line-strong: #C8C2B4;
 *     // Accent (burnt sienna)
 *     --color-accent:        #B14C26;
 *     --color-accent-hover:  #8F3B1B;
 *     --color-accent-subtle: #FAEDE6;
 *     // Semantic
 *     --color-success:        #2E7D5B;
 *     --color-success-subtle: #E1F0E8;
 *     --color-warning:        #A65D00;
 *     --color-warning-subtle: #FBEFD8;
 *     --color-error:          #B43E3E;
 *     --color-error-subtle:   #F5E0E0;
 *     --color-info:           #3A5DA8;
 *     --color-info-subtle:    #E0E8F5;
 *   }
 *
 *   .dark {
 *     // Surfaces
 *     --color-paper:          #14130F;
 *     --color-paper-elevated: #1C1B16;
 *     --color-paper-sunken:   #0D0C0A;
 *     // Ink
 *     --color-ink:        #F1EEE7;
 *     --color-ink-muted:  #A8A498;
 *     --color-ink-subtle: #6A6759;
 *     // Lines
 *     --color-line:        #2A2823;
 *     --color-line-strong: #3F3C34;
 *     // Accent (burnt sienna, retuned)
 *     --color-accent:        #D9794F;
 *     --color-accent-hover:  #E89370;
 *     --color-accent-subtle: #2F1F17;
 *     // Semantic (retuned for dark)
 *     --color-success:        #5FB892;
 *     --color-success-subtle: #162822;
 *     --color-warning:        #E89B3D;
 *     --color-warning-subtle: #2C200F;
 *     --color-error:          #E87878;
 *     --color-error-subtle:   #2C1818;
 *     --color-info:           #7DA0E5;
 *     --color-info-subtle:    #15202D;
 *   }
 *
 *   body {
 *     background-color: var(--color-paper);
 *     color: var(--color-ink);
 *     font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Inter', sans-serif;
 *     font-feature-settings: 'cv11', 'ss01', 'ss03'; // Inter stylistic alternates
 *   }
 *
 *   // Long-form content uses serif by default
 *   .prose, article p, article li {
 *     font-family: 'Source Serif 4', Iowan Old Style, Baskerville, serif;
 *   }
 *
 *   // Reduced-motion (non-negotiable)
 *   @media (prefers-reduced-motion: reduce) {
 *     *, *::before, *::after {
 *       animation-duration: 0.01ms !important;
 *       animation-iteration-count: 1 !important;
 *       transition-duration: 0.01ms !important;
 *       scroll-behavior: auto !important;
 *     }
 *   }
 * }
 *
 * --------------------------------------------------------------------- */
