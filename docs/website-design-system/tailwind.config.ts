/**
 * CAIA Public Website — Tailwind v3 config (v1.0)
 *
 * Paste-ready. Drop into the website Next.js project's root and run
 *   pnpm add -D tailwindcss postcss autoprefixer @tailwindcss/typography
 *   npx tailwindcss init -p   # if no postcss.config.js yet
 *
 * Companion files:
 *   - docs/website-design-system/README.md      (spec)
 *   - docs/website-design-system/components.html (examples)
 *
 * Theming strategy:
 *   - Class-based dark mode (`class="dark"` on <html>)
 *   - All color tokens exposed as full 50–950 scales so utilities
 *     (bg-ember-500, text-slate-700, ring-mint-400/60) work uniformly.
 *   - Existing CAIA dashboard tokens preserved inside the dark palette:
 *       slate-950 = #0F1117   (dashboard bg)
 *       slate-100 ≈ #EEF1F5   (close to dashboard fg #e2e8f0)
 *       legacy-link = #63B3ED (dark-mode link / info)
 */

import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx,mdx}",
    "./components/**/*.{ts,tsx}",
    "./content/**/*.{md,mdx}",
  ],
  theme: {
    // override defaults so designers cannot reach for off-system tokens by accident
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
      "3xl": "1920px",
    },

    container: {
      center: true,
      padding: {
        DEFAULT: "1.5rem", // 24
        md: "2rem", // 32
        lg: "3rem", // 48
      },
      screens: {
        xl: "1280px",
        "2xl": "1280px",
      },
    },

    extend: {
      // ────────────────────────────────────────────────────────────
      // Color
      // ────────────────────────────────────────────────────────────
      colors: {
        // Brand primary — Ember (warm clay/coral)
        ember: {
          50: "#FFF5F1",
          100: "#FFE4D8",
          200: "#FFC6AE",
          300: "#FFA079",
          400: "#FA7A4E",
          500: "#E45A2E", // anchor — primary buttons on light
          600: "#C44520",
          700: "#9D341A",
          800: "#762818",
          900: "#4C1A12",
          950: "#2A0E0A",
        },

        // Neutral structural — Slate (cool undertone)
        slate: {
          0: "#FFFFFF",
          50: "#F7F8FA",
          100: "#EEF1F5",
          200: "#DDE3EB",
          300: "#C2CBD6",
          400: "#97A2B1",
          500: "#6B7585",
          600: "#4B5564",
          700: "#343C4A",
          800: "#1F2632",
          900: "#131822",
          950: "#0F1117", // preserved from existing dashboard
        },

        // Accent — Mint (AI / system-state)
        mint: {
          50: "#ECFDF5",
          100: "#CFFAEA",
          200: "#9CF4D2",
          300: "#5EE5B5",
          400: "#25CF96",
          500: "#0FB47C", // anchor
          600: "#0A8E64",
          700: "#0A6F50",
          800: "#0A5440",
          900: "#053124",
        },

        // Semantic — flat tokens so utility classes read clearly
        success: {
          DEFAULT: "#16A34A",
          fg: "#0F2A18",
          bg: "#F0FDF4",
          "dark-bg": "#0F2A18",
          "dark-fg": "#22C55E",
        },
        warning: {
          DEFAULT: "#D97706",
          fg: "#2A1C05",
          bg: "#FFFBEB",
          "dark-bg": "#2A1C05",
          "dark-fg": "#F59E0B",
        },
        error: {
          DEFAULT: "#DC2626",
          fg: "#2A0E0E",
          bg: "#FEF2F2",
          "dark-bg": "#2A0E0E",
          "dark-fg": "#F87171",
        },
        info: {
          DEFAULT: "#2563EB",
          fg: "#0F1A2A",
          bg: "#EFF6FF",
          "dark-bg": "#0F1A2A",
          "dark-fg": "#63B3ED", // legacy dashboard link preserved here
        },

        // Syntax highlighting palette (code blocks)
        syntax: {
          keyword: "#C792EA",
          string: "#C3E88D",
          number: "#F78C6C",
          function: "#82AAFF",
          comment: "#6B7585",
          variable: "#EEF1F5",
          operator: "#89DDFF",
          constant: "#FFCB6B",
        },
      },

      // ────────────────────────────────────────────────────────────
      // Typography
      // ────────────────────────────────────────────────────────────
      fontFamily: {
        sans: [
          "Geist",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "Noto Sans",
          "sans-serif",
        ],
        mono: [
          "Geist Mono",
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
        // Editorial accent — pull quotes, stat-callouts, hero phrases (use sparingly)
        serif: [
          "Newsreader",
          "ui-serif",
          "Georgia",
          "Cambria",
          "Times New Roman",
          "serif",
        ],
      },

      // Type scale — each entry: [size, { lineHeight, letterSpacing, fontWeight }]
      fontSize: {
        "display-2xl": ["4.5rem", { lineHeight: "1.05", letterSpacing: "-0.03em", fontWeight: "600" }],
        "display-xl": ["3.75rem", { lineHeight: "1.08", letterSpacing: "-0.025em", fontWeight: "600" }],
        "display-lg": ["3rem", { lineHeight: "1.1", letterSpacing: "-0.02em", fontWeight: "600" }],
        h1: ["2.25rem", { lineHeight: "1.15", letterSpacing: "-0.015em", fontWeight: "600" }],
        h2: ["1.75rem", { lineHeight: "1.2", letterSpacing: "-0.01em", fontWeight: "600" }],
        h3: ["1.375rem", { lineHeight: "1.3", letterSpacing: "0", fontWeight: "600" }],
        h4: ["1.125rem", { lineHeight: "1.4", letterSpacing: "0", fontWeight: "600" }],
        "body-lg": ["1.125rem", { lineHeight: "1.6", letterSpacing: "0", fontWeight: "400" }],
        body: ["1rem", { lineHeight: "1.6", letterSpacing: "0", fontWeight: "400" }],
        "body-sm": ["0.875rem", { lineHeight: "1.55", letterSpacing: "0", fontWeight: "400" }],
        caption: ["0.75rem", { lineHeight: "1.5", letterSpacing: "0.02em", fontWeight: "500" }],
        code: ["0.9375rem", { lineHeight: "1.55", letterSpacing: "0", fontWeight: "450" }],
        "code-sm": ["0.8125rem", { lineHeight: "1.5", letterSpacing: "0", fontWeight: "450" }],
      },

      // ────────────────────────────────────────────────────────────
      // Spacing — 4px base, named tokens (also keep numeric defaults)
      // ────────────────────────────────────────────────────────────
      spacing: {
        "3xs": "0.125rem", // 2
        "2xs": "0.25rem", // 4
        xs: "0.5rem", // 8
        sm: "0.75rem", // 12
        md: "1rem", // 16
        lg: "1.5rem", // 24
        xl: "2rem", // 32
        "2xl": "3rem", // 48
        "3xl": "4rem", // 64
        "4xl": "6rem", // 96
        "5xl": "8rem", // 128
      },

      maxWidth: {
        prose: "45rem", // ~720px @ 16px (≈68ch at 18px body)
        narrow: "50rem", // 800
        content: "80rem", // 1280
        wide: "90rem", // 1440
      },

      // ────────────────────────────────────────────────────────────
      // Radius & shadow
      // ────────────────────────────────────────────────────────────
      borderRadius: {
        sm: "0.25rem", // 4
        md: "0.5rem", // 8 — buttons
        lg: "0.75rem", // 12 — cards, code blocks
        xl: "1rem", // 16 — hero media frame
        "2xl": "1.5rem", // 24 — full-bleed hero containers
        full: "9999px",
      },

      boxShadow: {
        // Used sparingly — only on hover-lifted cards and the hero media frame.
        sm: "0 1px 2px rgba(15, 17, 23, 0.04), 0 1px 1px rgba(15, 17, 23, 0.06)",
        md: "0 4px 12px rgba(15, 17, 23, 0.06), 0 2px 4px rgba(15, 17, 23, 0.04)",
        lg: "0 12px 32px rgba(15, 17, 23, 0.08), 0 4px 8px rgba(15, 17, 23, 0.04)",
        xl: "0 24px 56px rgba(15, 17, 23, 0.12), 0 8px 16px rgba(15, 17, 23, 0.06)",
        ring: "0 0 0 2px rgba(228, 90, 46, 0.4)", // focus-visible
      },

      // ────────────────────────────────────────────────────────────
      // Z-index — short, named, no integer-stacking wars
      // ────────────────────────────────────────────────────────────
      zIndex: {
        base: "0",
        raised: "10",
        sticky: "20",
        overlay: "30",
        modal: "40",
        popover: "50",
        toast: "60",
        tooltip: "70",
      },

      // ────────────────────────────────────────────────────────────
      // Motion
      // ────────────────────────────────────────────────────────────
      transitionTimingFunction: {
        // Linear-style ease — fast accelerate, soft settle
        standard: "cubic-bezier(0.2, 0, 0, 1)",
        // Slight overshoot feel without bounce
        expressive: "cubic-bezier(0.32, 0.72, 0, 1)",
      },

      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        relaxed: "320ms",
        expressive: "480ms",
      },

      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "skeleton-pulse": {
          "0%,100%": { backgroundColor: "#EEF1F5" },
          "50%": { backgroundColor: "#DDE3EB" },
        },
      },

      animation: {
        "fade-in": "fade-in 200ms cubic-bezier(0.2, 0, 0, 1)",
        "fade-up": "fade-up 320ms cubic-bezier(0.2, 0, 0, 1)",
        skeleton: "skeleton-pulse 1.6s ease-in-out infinite",
      },

      // ────────────────────────────────────────────────────────────
      // Typography plugin overrides (prose / prose-invert)
      // ────────────────────────────────────────────────────────────
      typography: ({ theme }: { theme: (k: string) => string }) => ({
        DEFAULT: {
          css: {
            color: theme("colors.slate.800"),
            maxWidth: theme("maxWidth.prose"),
            a: {
              color: theme("colors.ember.600"),
              textDecoration: "none",
              fontWeight: "500",
              "&:hover": { color: theme("colors.ember.700"), textDecoration: "underline" },
            },
            h1: { fontWeight: "600", letterSpacing: "-0.015em" },
            h2: { fontWeight: "600", letterSpacing: "-0.01em" },
            h3: { fontWeight: "600" },
            code: {
              fontFamily: theme("fontFamily.mono").join(", "),
              backgroundColor: theme("colors.slate.100"),
              color: theme("colors.slate.800"),
              padding: "0 6px",
              borderRadius: "4px",
              fontWeight: "450",
            },
            "code::before": { content: "none" },
            "code::after": { content: "none" },
            pre: {
              backgroundColor: theme("colors.slate.900"),
              color: theme("colors.slate.100"),
              borderRadius: theme("borderRadius.lg"),
              padding: "1.5rem 2rem",
            },
          },
        },
        invert: {
          css: {
            color: theme("colors.slate.100"),
            a: {
              color: theme("colors.info.dark-fg"),
              "&:hover": { color: theme("colors.ember.300") },
            },
            code: {
              backgroundColor: theme("colors.slate.800"),
              color: theme("colors.slate.100"),
            },
          },
        },
      }),
    },
  },

  plugins: [
    typography,
    // Custom focus-visible plugin: always provide a visible focus ring,
    // and use the Ember anchor color rather than the default browser blue.
    function focusVisiblePlugin({ addUtilities }: { addUtilities: (utils: Record<string, unknown>) => void }) {
      addUtilities({
        ".focus-ring": {
          outline: "none",
          "&:focus-visible": {
            outline: "2px solid #FA7A4E",
            "outline-offset": "2px",
            "border-radius": "0.5rem",
          },
        },
      });
    },
  ],
};

export default config;
