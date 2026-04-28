# @chiefaia/dev-inspector

Dev-only React inspector panel with five tabs: **Accessibility** (live axe-core scan),
**Integrity**, **Console**, **Network**, **Performance** (Core Web Vitals via `web-vitals`).
Toggle with **Cmd+Shift+I**. Draggable, resizable, dev-only — fully tree-shaken in production.

> **History:** v0.1.0 was a hover-overlay element inspector. v0.2.0 (this version) is a
> tabbed dashboard — see [`CHANGELOG.md`](./CHANGELOG.md) for the rationale and
> [`legacy/`](./legacy) for the archived v0.1.0 source.

## Features

- **Cmd+Shift+I** to toggle the panel
- Draggable title bar, ns-resize handle for height
- **Accessibility tab** — runs `axe-core` against the live DOM; lists violations with impact + selector
- **Integrity tab** — placeholder until `@chiefaia/integrity-check` is wired in
- **Console tab** — intercepts `console.{log,info,warn,error}` and shows the entries inside the panel
- **Network tab** — instruments `fetch` and `XMLHttpRequest`; shows method, URL, status, duration
- **Performance tab** — LCP, INP, CLS via `web-vitals` with rating (good / needs-improvement / poor)
- **MCP bridge** — `startBridge` / `stopBridge` expose a snapshot via `window.__caiaDevInspector` for
  AI orchestrators
- **Zero production footprint** — `Provider` returns plain children when `NODE_ENV !== 'development'`,
  and the `Panel` import is gated behind a `process.env.NODE_ENV === 'development'` check so webpack
  dead-code-eliminates the entire panel module in production builds

## Usage

```tsx
// src/app/layout.tsx
import { DevInspectorProvider } from '@chiefaia/dev-inspector';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <DevInspectorProvider>
          {children}
        </DevInspectorProvider>
      </body>
    </html>
  );
}
```

## next.config.js

```js
const nextConfig = {
  transpilePackages: ['@chiefaia/dev-inspector'],
};
```

## Peer dependencies

| Package | Required for | Optional? |
|---------|--------------|-----------|
| `react` `>=18` | All | No |
| `react-dom` `>=18` | All | No |
| `axe-core` `>=4` | Accessibility tab | Yes (tab fails-soft) |
| `web-vitals` `>=4` | Performance tab | Yes (tab shows N/A) |

## Development

```bash
pnpm test           # unit tests (vitest)
pnpm test:e2e       # playwright E2E (requires running dev server)
pnpm build          # compile to dist/ (excludes legacy/)
```
