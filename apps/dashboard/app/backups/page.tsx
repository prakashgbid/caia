/**
 * /backups — DEPRECATED (DASH-006).
 *
 * GET /db-backups returns [] in CAIA — there is no backup subsystem
 * currently scheduled. Per the audit
 * (~/Documents/projects/reports/dashboard-nav-audit-2026-04-30.md),
 * this route is retired in favour of /operations.
 *
 * The redirect lives in apps/dashboard/redirects.js. This file remains as
 * a defensive fallback for environments where Next redirects might not
 * fire (e.g. local dev without next.config.js loaded).
 */
import { redirect } from 'next/navigation';

export default function BackupsDeprecated() {
  redirect('/operations');
}
