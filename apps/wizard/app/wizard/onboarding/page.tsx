/**
 * Wizard Step 1 — Onboarding (LIGHTWEIGHT).
 *
 * REVISED 2026-08-26 per [[deferred-physical-tenant]] + [[byok-first-ai]]:
 * the pre-payment funnel must stay FAST. The old 19-category upfront
 * credential collection was a wall built for the old assumption that
 * we'd provision a whole tenant on signup. Under the new model, nothing
 * gets provisioned until payment, so we ask only what we need to route
 * AI calls now (optional BYOK key) and identify the founder.
 *
 * The full 19-category catalogue lives on at page.tsx.heavy19cat.bak
 * and its component (OnboardingStepForm) is preserved for a future
 * post-payment "Complete your setup" or /settings/credentials surface
 * that lands once the founder has crossed the paywall.
 *
 * Form fields:
 *   - Display name (required, 2-80 chars)
 *   - Email (required, valid format)
 *   - OpenRouter API key (optional — enables BYOK; sk-or-v1-... format)
 *
 * On submit → POST /api/wizard/onboarding/lightweight → navigate to
 * /wizard/grand-idea?tenantSlug=<slug>.
 *
 * In WIZARD_AUTH_MODE=disabled (public demo) the shim will canned-success
 * the POST and the redirect happens either way — no session persistence.
 */

import { LightweightOnboardingForm } from '../../../components/wizard/LightweightOnboardingForm';

export const dynamic = 'force-dynamic';

export default async function OnboardingPage(): Promise<React.JSX.Element> {
  return <LightweightOnboardingForm />;
}
