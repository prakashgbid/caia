# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: live-wizard-smoke.spec.ts >> Live wizard smoke — all 7 steps against dashboard.chiefaia.com >> walks Onboarding → Atlas and asserts FSM + Postgres + Tempo per step
- Location: tests/e2e/live-wizard-smoke.spec.ts:305:7

# Error details

```
CloudflareAccessAuthError: No Cloudflare Access auth mode configured for the live wizard smoke.

Set ONE of the following:

  1. PLAYWRIGHT_STORAGE_STATE=<path/to/state.json>
       Capture with: pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture

  2. CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET
       Generate in Cloudflare Zero Trust → Access → Service Auth → Service Tokens

Observed: storageStatePath=(unset), clientIdSet=false, clientSecretSet=false
```

# Test source

```ts
  3   |  *
  4   |  * Cloudflare Access auth helper for the live-wizard-smoke spec.
  5   |  *
  6   |  * The production dashboard at https://dashboard.chiefaia.com sits behind
  7   |  * a Cloudflare Access application (app id `cb6d1de5-2ab6-4860-af9e-7395ca0a8381`,
  8   |  * allowlists `prakash.stolution@gmail.com`). Interactive SSO is not
  9   |  * scriptable from headless Chrome, so we support two non-interactive
  10  |  * paths:
  11  |  *
  12  |  *   1. `storageState` — a pre-captured browser session. The operator runs
  13  |  *      `pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture` once,
  14  |  *      signs in interactively in the launched browser, and a cookie jar
  15  |  *      + localStorage snapshot is written to disk. Subsequent runs reuse
  16  |  *      the file. Cookies expire (CF Access default = 24h), so the smoke
  17  |  *      runbook prompts to re-capture when the smoke's first request
  18  |  *      bounces to /sign-in.
  19  |  *
  20  |  *   2. `service-token` — Cloudflare Access service-token pair
  21  |  *      (`CF-Access-Client-Id` + `CF-Access-Client-Secret`) is passed via
  22  |  *      `extraHTTPHeaders` in playwright.live-smoke.config.ts. Service
  23  |  *      tokens are issued in the Cloudflare Zero Trust dashboard under
  24  |  *      Access → Service Auth → Service Tokens. They don't expire on a
  25  |  *      24h clock — they're long-lived secrets — which makes them the
  26  |  *      preferred path for CI nightly runs.
  27  |  *
  28  |  * This helper exposes:
  29  |  *
  30  |  *   - `ensureAuthMode()`    — assert at least one auth mode is configured;
  31  |  *                             throws a clear error otherwise. Called from
  32  |  *                             the spec's `beforeAll`.
  33  |  *
  34  |  *   - `getAuthMode()`       — return `'storageState' | 'service-token'`
  35  |  *                             for logging / runbook traceability.
  36  |  *
  37  |  *   - `captureStorageState()` — opens a real Chromium browser, navigates
  38  |  *                               to the live dashboard, and waits for the
  39  |  *                               operator to complete sign-in. Writes the
  40  |  *                               resulting storageState JSON to the path
  41  |  *                               in `PLAYWRIGHT_STORAGE_STATE`.
  42  |  *
  43  |  * Run with `pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture`.
  44  |  *
  45  |  * Reuse-first: this is a pure helper module — no new Playwright fork, no
  46  |  * new auth lib. We use `@playwright/test`'s `chromium.launch` and the
  47  |  * built-in `context.storageState({path})` API.
  48  |  */
  49  | 
  50  | import { chromium } from '@playwright/test';
  51  | import * as fs from 'node:fs';
  52  | import * as path from 'node:path';
  53  | 
  54  | export type AuthMode = 'storageState' | 'service-token';
  55  | 
  56  | export const LIVE_DASHBOARD_URL =
  57  |   process.env.LIVE_DASHBOARD_URL ?? 'https://dashboard.chiefaia.com';
  58  | 
  59  | export interface AuthEnv {
  60  |   storageStatePath?: string;
  61  |   cfAccessClientId?: string;
  62  |   cfAccessClientSecret?: string;
  63  | }
  64  | 
  65  | export function readAuthEnv(env: NodeJS.ProcessEnv = process.env): AuthEnv {
  66  |   return {
  67  |     storageStatePath: env.PLAYWRIGHT_STORAGE_STATE,
  68  |     cfAccessClientId: env.CF_ACCESS_CLIENT_ID,
  69  |     cfAccessClientSecret: env.CF_ACCESS_CLIENT_SECRET,
  70  |   };
  71  | }
  72  | 
  73  | export function getAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode | null {
  74  |   const e = readAuthEnv(env);
  75  |   // storageState wins when both are set — it's a pre-resolved real user
  76  |   // session, which gives us the cleanest signal for tenant-provisioning
  77  |   // edge cases. Service-token is the fallback / CI default.
  78  |   if (e.storageStatePath && fs.existsSync(e.storageStatePath)) {
  79  |     return 'storageState';
  80  |   }
  81  |   if (e.cfAccessClientId && e.cfAccessClientSecret) {
  82  |     return 'service-token';
  83  |   }
  84  |   return null;
  85  | }
  86  | 
  87  | export class CloudflareAccessAuthError extends Error {
  88  |   constructor(message: string) {
  89  |     super(message);
  90  |     this.name = 'CloudflareAccessAuthError';
  91  |   }
  92  | }
  93  | 
  94  | /**
  95  |  * Asserts at least ONE non-interactive auth mode is configured. Called
  96  |  * from the smoke spec's `test.beforeAll` so the failure surfaces in the
  97  |  * test report instead of as a config-load stack trace.
  98  |  */
  99  | export function ensureAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  100 |   const mode = getAuthMode(env);
  101 |   if (mode) return mode;
  102 |   const e = readAuthEnv(env);
> 103 |   throw new CloudflareAccessAuthError(
      |         ^ CloudflareAccessAuthError: No Cloudflare Access auth mode configured for the live wizard smoke.
  104 |     [
  105 |       'No Cloudflare Access auth mode configured for the live wizard smoke.',
  106 |       '',
  107 |       'Set ONE of the following:',
  108 |       '',
  109 |       '  1. PLAYWRIGHT_STORAGE_STATE=<path/to/state.json>',
  110 |       '       Capture with: pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture',
  111 |       '',
  112 |       '  2. CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET',
  113 |       '       Generate in Cloudflare Zero Trust → Access → Service Auth → Service Tokens',
  114 |       '',
  115 |       `Observed: storageStatePath=${e.storageStatePath ?? '(unset)'}, ` +
  116 |         `clientIdSet=${Boolean(e.cfAccessClientId)}, ` +
  117 |         `clientSecretSet=${Boolean(e.cfAccessClientSecret)}`,
  118 |     ].join('\n'),
  119 |   );
  120 | }
  121 | 
  122 | /**
  123 |  * Opens a real (headed) Chromium, lets the operator sign in to CF
  124 |  * Access, then snapshots cookies + localStorage to a JSON file. The
  125 |  * smoke spec re-uses the file on subsequent runs.
  126 |  *
  127 |  * Usage:
  128 |  *
  129 |  *   PLAYWRIGHT_STORAGE_STATE=./tests/e2e/.auth/live-state.json \
  130 |  *     pnpm tsx tests/e2e/setup-cloudflare-access.ts --capture
  131 |  *
  132 |  * If the env var is unset, defaults to `./tests/e2e/.auth/live-state.json`.
  133 |  */
  134 | export async function captureStorageState(opts?: {
  135 |   storageStatePath?: string;
  136 |   liveDashboardUrl?: string;
  137 | }): Promise<string> {
  138 |   const outPath =
  139 |     opts?.storageStatePath ??
  140 |     process.env.PLAYWRIGHT_STORAGE_STATE ??
  141 |     path.join(process.cwd(), 'tests', 'e2e', '.auth', 'live-state.json');
  142 |   const url = opts?.liveDashboardUrl ?? LIVE_DASHBOARD_URL;
  143 | 
  144 |   fs.mkdirSync(path.dirname(outPath), { recursive: true });
  145 | 
  146 |   // eslint-disable-next-line no-console
  147 |   console.log(
  148 |     `[setup-cloudflare-access] Launching Chromium headed → ${url}\n` +
  149 |       `  Sign in via your Cloudflare Access SSO when prompted.\n` +
  150 |       `  Storage state will be written to: ${outPath}`,
  151 |   );
  152 | 
  153 |   const browser = await chromium.launch({ headless: false });
  154 |   const context = await browser.newContext();
  155 |   const page = await context.newPage();
  156 |   await page.goto(url, { waitUntil: 'load' });
  157 | 
  158 |   // Heuristic: we wait until the post-sign-in /wizard route is reached.
  159 |   // The dashboard middleware redirects un-authed users to /sign-in?from=…
  160 |   // Once the CF cookie lands, refreshing or navigating to /wizard
  161 |   // succeeds with a 200. We poll for up to 5 minutes (operator's SSO
  162 |   // round-trip + any 2FA prompts).
  163 |   // eslint-disable-next-line no-console
  164 |   console.log(
  165 |     '[setup-cloudflare-access] Waiting up to 5 min for sign-in to complete…',
  166 |   );
  167 |   const deadline = Date.now() + 5 * 60 * 1000;
  168 |   while (Date.now() < deadline) {
  169 |     try {
  170 |       const res = await page.goto(`${url}/wizard/onboarding`, {
  171 |         waitUntil: 'domcontentloaded',
  172 |         timeout: 30_000,
  173 |       });
  174 |       // 200 means we cleared the CF Access gate AND the dashboard
  175 |       // middleware (which checks the CF_Authorization JWT).
  176 |       if (res && res.status() === 200 && !page.url().includes('/sign-in')) {
  177 |         break;
  178 |       }
  179 |     } catch {
  180 |       /* keep waiting */
  181 |     }
  182 |     await page.waitForTimeout(3_000);
  183 |   }
  184 | 
  185 |   if (page.url().includes('/sign-in')) {
  186 |     await browser.close();
  187 |     throw new CloudflareAccessAuthError(
  188 |       'Sign-in did not complete within 5 minutes. Aborting capture.',
  189 |     );
  190 |   }
  191 | 
  192 |   await context.storageState({ path: outPath });
  193 |   await browser.close();
  194 | 
  195 |   // eslint-disable-next-line no-console
  196 |   console.log(`[setup-cloudflare-access] Wrote storage state → ${outPath}`);
  197 |   return outPath;
  198 | }
  199 | 
  200 | // CLI entrypoint — keep this module importable AND runnable.
  201 | if (require.main === module) {
  202 |   const args = process.argv.slice(2);
  203 |   if (args.includes('--capture')) {
```