/** @type {import('tailwindcss').Config} */
// Theme mirrors the design tokens used in apps/website-mockups/*.html so
// promoting a mockup is mostly a copy/paste once content is final.
// If/when a shared @caia-app/design-tokens package lands, swap to import from there.
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0a0c12',
          900: '#0f1117',
          850: '#141823',
          800: '#1a1f2e',
          700: '#252a3a',
          600: '#2d3748',
        },
        chalk: {
          50: '#f8fafc',
          100: '#f0f4f8',
          300: '#cbd5e1',
          400: '#a0aec0',
          500: '#64748b',
        },
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
        },
        accent: { 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed' },
        mint: { 400: '#34d399', 500: '#10b981' },
        amber: { 400: '#fbbf24', 500: '#f59e0b' },
        rose: { 400: '#fb7185', 500: '#ef4444' },
        sky: { 400: '#63b3ed' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(99,102,241,0.35), 0 8px 32px -8px rgba(99,102,241,0.45)',
      },
    },
  },
  plugins: [],
};
