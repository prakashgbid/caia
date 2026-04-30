/**
 * /enforcement — DEPRECATED (DASH-006).
 *
 * The previous 866-line enforcement page was mock-only — the
 * `enforcement_rules` table and corresponding handlers were never shipped
 * (DASH-308 explicitly defers the real backend). Until that ships, the
 * closest meaningful surface is /quality/gates (human-gate artifacts).
 *
 * The canonical redirect lives in apps/dashboard/redirects.js. This file
 * is a defensive fallback.
 */
import { redirect } from 'next/navigation';

export default function EnforcementDeprecated() {
  redirect('/quality/gates');
}
