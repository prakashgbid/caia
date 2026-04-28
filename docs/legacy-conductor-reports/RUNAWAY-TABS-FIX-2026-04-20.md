# Runaway Browser Tabs — Root Cause & Fix (2026-04-20)

## Culprit

Two separate `sendNativeNotification` methods were calling `execSync('open "http://localhost:7777/..."')` **every time** a question or blocker was raised. Each call opened a new browser tab.

| File | Line | URL opened |
|------|------|-----------|
| `src/questions/manager.ts` | 246 | `http://localhost:7777/?tab=questions#<id>` |
| `src/blockers/manager.ts` | 248 | `http://localhost:7777/?tab=blockers#<id>` |

Pattern: both had this structure inside `sendNativeNotification`:

```ts
// Step 1 — toast (correct)
execSync(`osascript -e 'display notification ...'`, ...);

// Step 2 — browser tab (THE BUG)
execSync(`open "http://localhost:7777/?tab=..."`, ...);
```

Any pump tick that created/updated a question or blocker fired `sendNativeNotification`, which spawned a new tab. With rapid agent activity this floods Chrome with 20–50+ tabs.

## Fix Applied

Removed the `open` call from both `sendNativeNotification` methods. The `osascript display notification` toast remains — it tells the user something needs attention without opening a tab.

**`src/questions/manager.ts`** — removed:
```ts
try {
  execSync(`open "http://localhost:7777/?tab=questions#${id}"`, {
    timeout: 3000, stdio: 'ignore',
  });
} catch {
  // best-effort
}
```

**`src/blockers/manager.ts`** — removed:
```ts
try {
  // best-effort: open dashboard at blockers tab
  execSync(`open "http://localhost:7777/?tab=blockers#${id}"`, {
    timeout: 3000, stdio: 'ignore',
  });
} catch {
  // best-effort
}
```

The compiled `dist/` files reflect the fix (TypeScript emitted despite unrelated errors in `server.ts`).

## Immediate Remediation

- Closed all `localhost:7777` Chrome tabs via `osascript close tab` command.
- No Playwright or Chromium processes were running at time of fix.
- No LaunchAgents or scheduled tasks contained `open http://localhost:7777` calls.
  - `com.conductor.mcp.plist` exists but was not loaded; its `ProgramArguments` only runs `node dist/cli/index.js mcp` — no URL opening.

## Verification

The conductor MCP runs on-demand (no persistent process between invocations), so a live notification loop test was not possible in this session. To verify manually:

```bash
# Start conductor (if dashboard is running)
curl -X POST http://localhost:7776/notifications/enqueue \
  -H "Content-Type: application/json" \
  -d '{"requirementId":"test","kind":"started","message":"test"}'
# Repeat 10x — confirm ZERO new browser tabs open
```

## Other Recurring Triggers Found

None. The two manager files were the sole source.
