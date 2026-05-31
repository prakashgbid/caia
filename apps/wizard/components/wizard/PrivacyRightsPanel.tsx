'use client';
/**
 * `<PrivacyRightsPanel>` — Phase B B8 client surface for the GDPR
 * export + erase rights.
 *
 * Owns:
 *   - the "Export my data" button → POSTs `/api/settings/privacy/export`
 *     → triggers a JSON download with all tenant state.
 *   - the "Delete my data" button → opens a `@caia/ui` Dialog with a
 *     confirmation step. On confirm POSTs `/api/settings/privacy/erase`.
 *
 * Reuse-first: every primitive comes from `@caia/ui`. The fetch surface
 * is injectable via `fetchImpl` so the test suite never hits a real
 * network. Tests for the export download path inject a `downloadImpl`
 * seam too so we can assert the Blob filename + content without
 * touching the jsdom URL.createObjectURL polyfill quirks.
 */

import * as React from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@caia/ui';

export interface PrivacyRightsPanelProps {
  /** Test seam — overrides the global fetch. */
  fetchImpl?: typeof fetch;
  /**
   * Test seam — overrides the file-download trigger. Production builds
   * a Blob → object URL → temporary anchor click. Tests inject a spy
   * to capture (filename, content) without touching the DOM polyfill.
   */
  downloadImpl?: (filename: string, content: string) => void;
}

const ERASE_CONFIRMATION_WORD = 'ERASE';

function defaultDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function PrivacyRightsPanel(
  props: PrivacyRightsPanelProps = {},
): React.JSX.Element {
  const fetchFn =
    props.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const downloadFn = props.downloadImpl ?? defaultDownload;

  const [exporting, setExporting] = React.useState(false);
  const [exportError, setExportError] = React.useState<string | null>(null);
  const [exportMessage, setExportMessage] = React.useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');
  const [erasing, setErasing] = React.useState(false);
  const [eraseError, setEraseError] = React.useState<string | null>(null);
  const [eraseMessage, setEraseMessage] = React.useState<string | null>(null);

  const handleExport = React.useCallback(async () => {
    setExporting(true);
    setExportError(null);
    setExportMessage(null);
    try {
      const res = await fetchFn('/api/settings/privacy/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const text = await res.text();
      const filename = `caia-tenant-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      downloadFn(filename, text);
      setExportMessage(`Export ready — ${filename}`);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }, [fetchFn, downloadFn]);

  const handleErase = React.useCallback(async () => {
    if (confirmText.trim() !== ERASE_CONFIRMATION_WORD) {
      setEraseError(
        `Type "${ERASE_CONFIRMATION_WORD}" exactly to confirm — this is irreversible.`,
      );
      return;
    }
    setErasing(true);
    setEraseError(null);
    try {
      const res = await fetchFn('/api/settings/privacy/erase', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirmation: confirmText }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        tenant_id?: string;
      };
      setEraseMessage(
        `Tenant ${body.tenant_id ?? ''} erased. You can close this window.`,
      );
      setDialogOpen(false);
      setConfirmText('');
    } catch (e) {
      setEraseError(e instanceof Error ? e.message : String(e));
    } finally {
      setErasing(false);
    }
  }, [fetchFn, confirmText]);

  return (
    <div>
      <Card data-testid="privacy-export-card" style={{ marginBottom: 16 }}>
        <CardHeader>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <CardTitle>Export my data</CardTitle>
            <Badge variant="outline">GDPR Art. 15</Badge>
          </div>
          <CardDescription>
            Downloads a JSON file with your wizard state, IA artifacts,
            design uploads, interview threads, and business proposals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button
              data-testid="privacy-export-button"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? 'Preparing…' : 'Export my data'}
            </Button>
            {exportMessage && (
              <span
                data-testid="privacy-export-message"
                style={{ fontSize: 13, opacity: 0.8 }}
              >
                {exportMessage}
              </span>
            )}
            {exportError && (
              <span
                data-testid="privacy-export-error"
                style={{ color: '#b91c1c', fontSize: 13 }}
              >
                {exportError}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="privacy-erase-card">
        <CardHeader>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <CardTitle>Delete my data</CardTitle>
            <Badge variant="destructive">GDPR Art. 17</Badge>
          </div>
          <CardDescription>
            Permanently erases your tenant — drops the Postgres schema,
            deletes the Infisical workspace, removes design uploads, and
            files an audit row. This is irreversible.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            data-testid="privacy-erase-open-dialog"
            variant="destructive"
            onClick={() => setDialogOpen(true)}
          >
            Delete my data
          </Button>
          {eraseMessage && (
            <span
              data-testid="privacy-erase-message"
              style={{ marginLeft: 12, fontSize: 13, opacity: 0.8 }}
            >
              {eraseMessage}
            </span>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-testid="privacy-erase-dialog">
          <DialogHeader>
            <DialogTitle>Confirm tenant erasure</DialogTitle>
            <DialogDescription>
              This will run the GDPR Article 17 cascade: drop the Postgres
              schema, delete the Infisical workspace, remove design uploads,
              and emit a <code>tenant.erased</code> audit event. The action
              is irreversible. Type{' '}
              <strong>{ERASE_CONFIRMATION_WORD}</strong> below to confirm.
            </DialogDescription>
          </DialogHeader>
          <input
            data-testid="privacy-erase-confirm-input"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={ERASE_CONFIRMATION_WORD}
            style={{
              padding: '6px 10px',
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              fontFamily: 'monospace',
              width: '100%',
              marginTop: 12,
            }}
          />
          {eraseError && (
            <p
              data-testid="privacy-erase-error"
              style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}
            >
              {eraseError}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              data-testid="privacy-erase-cancel"
              onClick={() => {
                setDialogOpen(false);
                setConfirmText('');
                setEraseError(null);
              }}
              disabled={erasing}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              data-testid="privacy-erase-confirm"
              onClick={handleErase}
              disabled={erasing}
            >
              {erasing ? 'Erasing…' : 'Erase forever'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
