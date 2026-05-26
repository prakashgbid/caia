'use client';
/**
 * Wizard Step 6 — Design.
 *
 * Reads the design-app prompt from the prior Step 5 generation and
 * surfaces it as a copyable code block inside a `@caia/ui` Card. The
 * primary CTA opens a `@caia/ui` Dialog containing a stub
 * `@caia/design-ingest` upload form. On a confirmed upload, PATCHes
 * the wizard state to `design-uploaded` (the canonical FSM target;
 * the brief mentioned `external-design-uploaded`, but the canonical
 * state-machine literal is `design-uploaded` per
 * `packages/state-machine/dist/states.d.ts`).
 *
 * Reuse-first compliance:
 *   - UI: `@caia/ui` primitives only (Card, Button, Dialog, Input).
 *   - Domain shapes (the design-ingest upload contract) come from
 *     `@caia/design-ingest`.
 *   - FSM dispatch uses the existing
 *     `/api/wizard/[projectId]/state` route from PR #601.
 */

import { useCallback, useEffect, useState } from 'react';
import {
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
  Input,
} from '@caia/ui';
import { SOURCE_NAMES, type SourceName } from '@caia/design-ingest';

export interface DesignPanelProps {
  /** Override the global fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override the prompt text resolution (tests). Defaults to a stub. */
  initialPromptText?: string;
  /** Override the initial project ID (tests). */
  initialProjectId?: string;
  /** Inject a clipboard writer (tests). */
  clipboardWriter?: (text: string) => Promise<void> | void;
}

const DEFAULT_STUB_PROMPT =
  '# Design-App Prompt\n\nDesign a clean, modern dashboard with a left nav, a top bar, and a primary content area.\n\n## Pages\n- Home\n- Project list\n- Project detail\n\n## Design system\n- Palette: paper #ffffff, ink #0f172a, accent #1e293b\n- Type: Inter (display + body)\n- Motion: restrained';

export function DesignPanel(props: DesignPanelProps = {}): React.JSX.Element {
  const fetchFn = props.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const initialPromptText = props.initialPromptText ?? DEFAULT_STUB_PROMPT;

  const [projectId, setProjectId] = useState(props.initialProjectId ?? 'p-stub');
  const [promptText, setPromptText] = useState(initialPromptText);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploadSource, setUploadSource] = useState<SourceName>('cd-zip');
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  useEffect(() => {
    // Reset the copy state after a moment so a second copy attempt
    // re-triggers the visual indicator.
    if (copyState !== 'idle') {
      const t = setTimeout(() => setCopyState('idle'), 2000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [copyState]);

  const writeClipboard = useCallback(
    async (text: string) => {
      if (props.clipboardWriter) {
        await props.clipboardWriter(text);
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      throw new Error('clipboard unavailable');
    },
    [props.clipboardWriter],
  );

  const handleCopy = useCallback(async () => {
    try {
      await writeClipboard(promptText);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  }, [promptText, writeClipboard]);

  const handleUpload = useCallback(async () => {
    setUploading(true);
    setUploadError(null);
    setUploadMessage(null);
    try {
      // V1 — confirm the upload server-side via the wizard state PATCH.
      // Wave 2 wires the actual @caia/design-ingest Ingestor here.
      if (!uploadUrl.trim()) {
        throw new Error('paste the URL of your uploaded design first');
      }
      const res = await fetchFn(`/api/wizard/${projectId}/state`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          targetState: 'design-uploaded',
          reason: `wizard-step-6-upload:${uploadSource}`,
        }),
      });
      if (res.status === 409) {
        setUploadMessage('Already at design-uploaded — atlas step is reachable.');
        setDialogOpen(false);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setUploadMessage('Design uploaded — atlas step is reachable.');
      setDialogOpen(false);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [fetchFn, projectId, uploadSource, uploadUrl]);

  return (
    <Card data-testid="wizard-step-design">
      <CardHeader>
        <CardTitle>Step 6 — Design</CardTitle>
        <CardDescription>
          Copy the design-app prompt below, paste it into your tool of choice
          (Claude Design / Figma / v0 / Lovable / Bolt / Builder.io / Webflow),
          export the result as a Code-Drop ZIP, then upload it here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <label htmlFor="design-project-id" style={{ fontSize: 13, fontWeight: 600 }}>
            Project ID
          </label>
          <Input
            id="design-project-id"
            data-testid="design-project-id"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
          />
        </div>

        <Card data-testid="design-prompt-card">
          <CardHeader>
            <CardTitle>Design-App Prompt</CardTitle>
            <CardDescription>
              Copy this prompt and paste it into your design tool.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre
              data-testid="design-prompt-text"
              style={{
                whiteSpace: 'pre-wrap',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                fontSize: 13,
                background: '#0f172a',
                color: '#e2e8f0',
                padding: 12,
                borderRadius: 6,
                marginBottom: 12,
                maxHeight: 320,
                overflow: 'auto',
              }}
            >
              {promptText}
            </pre>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button
                variant="outline"
                onClick={handleCopy}
                data-testid="copy-prompt"
                type="button"
              >
                {copyState === 'copied' ? 'Copied!' : 'Copy prompt'}
              </Button>
              {copyState === 'error' && (
                <span data-testid="copy-error" style={{ color: '#b91c1c', fontSize: 13 }}>
                  Clipboard unavailable in this browser.
                </span>
              )}
              <Button
                variant="ghost"
                onClick={() => setPromptText(initialPromptText)}
                data-testid="reset-prompt"
                type="button"
              >
                Reset prompt
              </Button>
            </div>
          </CardContent>
        </Card>

        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button
            variant="default"
            onClick={() => setDialogOpen(true)}
            data-testid="open-upload-dialog"
            type="button"
          >
            I&apos;ve uploaded my design
          </Button>
          {uploadMessage && (
            <span data-testid="upload-message" style={{ color: '#065f46', fontSize: 13 }}>
              {uploadMessage}
            </span>
          )}
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent data-testid="upload-dialog">
            <DialogHeader>
              <DialogTitle>Upload your design</DialogTitle>
              <DialogDescription>
                Paste the URL of the design artifact you produced from the
                prompt. The Code-Drop ZIP adapter is the V1 default; others
                will land as Wave 2 wiring completes.
              </DialogDescription>
            </DialogHeader>
            <div style={{ marginTop: 12 }}>
              <label
                htmlFor="upload-source"
                style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}
              >
                Source
              </label>
              <select
                id="upload-source"
                data-testid="upload-source"
                value={uploadSource}
                onChange={(e) => setUploadSource(e.target.value as SourceName)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 13,
                  background: 'transparent',
                  color: 'inherit',
                }}
              >
                {SOURCE_NAMES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginTop: 12 }}>
              <label
                htmlFor="upload-url"
                style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}
              >
                URL or path
              </label>
              <Input
                id="upload-url"
                data-testid="upload-url"
                value={uploadUrl}
                onChange={(e) => setUploadUrl(e.target.value)}
                placeholder="https://example.com/my-design.zip"
              />
            </div>
            {uploadError && (
              <div data-testid="upload-error" style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>
                {uploadError}
              </div>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDialogOpen(false)}
                data-testid="cancel-upload"
                type="button"
              >
                Cancel
              </Button>
              <Button
                variant="default"
                onClick={handleUpload}
                disabled={uploading}
                data-testid="confirm-upload"
                type="button"
              >
                {uploading ? 'Uploading…' : 'Confirm upload'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
