/**
 * Wizard settings — Privacy & data rights surface (Phase B B8).
 *
 * GDPR Article 15 (right of access) → "Export my data" button POSTs to
 * `/api/settings/privacy/export` which returns a JSON Blob containing
 * the tenant's wizard state, IA artifacts, design-ingest uploads,
 * interview threads, and business proposals.
 *
 * GDPR Article 17 (right to erasure) → "Delete my data" button opens
 * a `@caia/ui` Dialog with a confirmation step. On confirm, POSTs to
 * `/api/settings/privacy/erase` which triggers the four-stage cascade:
 *   1. `@caia/design-ingest.GdprCoordinator.deleteAllForTenant` —
 *      ux_uploads + design_versions + snapshot blobs + secrets
 *   2. Infisical workspace deletion via `@caia/secrets-adapter`
 *   3. Per-tenant Postgres schema DROP CASCADE
 *   4. audit log + `tenant.erased` event via `@chiefaia/event-bus-nats`
 *
 * Reuse-first: every visible UI primitive comes from `@caia/ui`. The
 * client logic delegates to the shared `<PrivacyRightsPanel>` so the
 * server page stays a thin wrapper.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@caia/ui';
import { PrivacyRightsPanel } from '../../../components/wizard/PrivacyRightsPanel';

export const dynamic = 'force-dynamic';

export default function PrivacyPage(): React.JSX.Element {
  return (
    <Card data-testid="settings-privacy-page">
      <CardHeader>
        <CardTitle>Privacy &amp; data rights</CardTitle>
        <CardDescription>
          Under GDPR Articles 15 and 17 you can export everything CAIA holds
          about your tenant, or erase the entire tenant scope. Both actions
          run against the same per-tenant Postgres schema, blob storage,
          and Infisical workspace your wizard already uses.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PrivacyRightsPanel />
      </CardContent>
    </Card>
  );
}
