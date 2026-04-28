# Wire @pokerzeno/integrity-check into a Next.js project

## 1. Add as dev dependency

```json
// package.json
{
  "devDependencies": {
    "@pokerzeno/integrity-check": "file:../integrity-check"
  }
}
```

Then: `npm install`

## 2. Add scripts

```json
// package.json
{
  "scripts": {
    "integrity": "integrity scan .",
    "integrity:static": "integrity scan . --static-only",
    "integrity:fix": "integrity scan . --fix",
    "prebuild": "npm run integrity:static",
    "build": "next build"
  }
}
```

- `npm run integrity` — full scan (static + route validation)
- `npm run integrity:static` — fast static-only scan (used as prebuild gate)
- `npm run integrity:fix` — auto-fix obvious issues, then report remaining
- `npm run build` — runs integrity gate first via `prebuild`

## 3. Exit codes

| Code | Meaning |
|------|---------|
| `0` | Clean — no issues |
| `1` | Warnings only — build passes |
| `2` | Errors present — build fails |

## 4. What gets checked

### Static (always runs, zero server needed)
- **dead-onclick** — `onClick={() => {}}` and `onClick={noop}` flagged
- **button-without-action** — `<button>` with no onClick/type/form parent flagged
- **missing-href** — `<a href="">`, `<a href="#">`, `<Link href="">` flagged
- **unresolved-import** — relative imports pointing to missing files flagged
- **unknown-handler** — `onClick={handleFoo}` where `handleFoo` isn't in scope flagged

### Crawl (runs with static by default)
- All Next.js routes enumerated from `src/app/` file tree
- All internal link targets (`href="/route"`) validated against known routes
- With `--base-url http://localhost:3000`: HTTP HEAD probe every static route

### Runtime (requires `--base-url` and running server)
- Playwright opens every route
- Clicks every `button`, `[role=button]`, `input[type=submit]`
- Flags any that produce zero DOM/URL/network change

## 5. CI integration

```yaml
# .github/workflows/ci.yml
- name: Integrity check
  run: npm run integrity:static
  working-directory: ./poker-zeno

- name: Build
  run: npm run build
  working-directory: ./poker-zeno
```

## 6. Auto-fix

Running `integrity scan . --fix` applies safe automatic fixes:
- Removes empty `onClick` attributes (`onClick={() => {}}`)
- Replaces `href=""` with `href="/"`

Remaining issues (like `href="#"` on social links) are reported for manual resolution.
