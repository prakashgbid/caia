/**
 * /coverage — DEPRECATED (DASH-006).
 *
 * Replaced by /quality, which surfaces orchestrator-wide quality signals
 * including coverage as one of several gates. The conductor-specific
 * Jest/Istanbul artifact path that used to back this view was retired
 * with DASH-314 Phase 1.
 *
 * The canonical redirect lives in apps/dashboard/redirects.js. This file
 * is a defensive fallback.
 */
import { redirect } from 'next/navigation';

export default function CoverageDeprecated() {
  redirect('/quality');
}
