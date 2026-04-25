# @pokerzeno/dev-inspector

Dev-only React element inspector. Hover any element to see a red outline and stable component ID badge. Click badge to copy ID to clipboard.

## Features

- **Alt+I** or floating chip to toggle on/off
- Red 3px outline + glow on hovered elements
- Stable IDs derived from React fiber tree: `ComponentName[index]`
- Click-to-copy with toast notification
- `window.__devInspector` API for AI orchestrators
- **Zero production footprint** — no-ops and tree-shakes out when `NODE_ENV !== 'development'`
- Persists state in localStorage

## Usage

```tsx
// src/app/layout.tsx
import { DevInspectorProvider } from '@pokerzeno/dev-inspector';

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
  transpilePackages: ['@pokerzeno/dev-inspector'],
};
```

## Global API

```js
window.__devInspector.find('ComponentName')      // → HTMLElement | null
window.__devInspector.highlight('ComponentName') // scroll + flash
window.__devInspector.list()                     // → string[]
window.__devInspector.toggle(true|false)         // programmatic toggle
```

## URL Activation

`?inspect=1` in URL auto-activates on load.

## Development

```bash
npm test          # unit tests (vitest)
npm run test:e2e  # playwright E2E (requires running dev server)
npm run build     # compile to dist/
```
