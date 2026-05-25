/**
 * @caia/grand-idea — UI Component.
 *
 * Default-export React functional component for Stage 2 capture.
 * Visual language matches `apps/admin/components/Wizard.tsx` (the
 * canonical onboarding form) — inline styles, neutral palette,
 * minimal chrome. Reads "shadcn-aligned" as visual cohesion rather
 * than as a runtime dependency on `@shadcn/ui`.
 *
 * Server-side rendering is supported: the component takes a
 * `fetchImpl` prop so non-DOM hosts can wire their own HTTP client.
 */

import { useCallback, useMemo, useState } from 'react';

import { GRAND_IDEA_WORD_CEILING, GRAND_IDEA_WORD_FLOOR, computeWordCount } from './types.js';

import type { CaptureResponse, CaptureResponseOk } from './types.js';

export interface GrandIdeaFormProps {
  tenantSlug: string;
  projectId: string;
  initialPrompt?: string;
  onCaptured?: (result: CaptureResponseOk) => void;
  onError?: (message: string, error?: CaptureResponse | undefined) => void;
  apiBasePath?: string;
  /** Override the global fetch (tests / SSR). */
  fetchImpl?: typeof fetch;
}

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error';

interface FormResult {
  status: SubmitStatus;
  message?: string;
}

const styles = {
  container: {
    maxWidth: 720,
    margin: '40px auto',
    padding: 24,
    background: 'white',
    borderRadius: 12,
    boxShadow: '0 1px 2px rgba(0,0,0,.06)',
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  },
  heading: { margin: 0, fontSize: 22, color: '#0f172a' },
  subheading: { marginTop: 6, color: '#475569', fontSize: 14 },
  label: { display: 'block', marginTop: 20, fontWeight: 600, fontSize: 13, color: '#0f172a' },
  textarea: {
    marginTop: 8,
    width: '100%',
    minHeight: 220,
    padding: 12,
    borderRadius: 6,
    border: '1px solid #cbd5e1',
    fontSize: 14,
    fontFamily: 'inherit',
    lineHeight: 1.5,
    boxSizing: 'border-box' as const,
    resize: 'vertical' as const,
  },
  meta: {
    marginTop: 6,
    fontSize: 12,
    color: '#64748b',
    display: 'flex',
    justifyContent: 'space-between',
  },
  metaError: { color: '#b91c1c', fontWeight: 600 },
  buttonRow: { marginTop: 24, display: 'flex', gap: 12 },
  submit: {
    padding: '10px 16px',
    background: '#1e293b',
    color: 'white',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
  },
  submitDisabled: {
    padding: '10px 16px',
    background: '#94a3b8',
    color: 'white',
    borderRadius: 6,
    border: 'none',
    cursor: 'not-allowed',
    fontWeight: 600,
    fontSize: 14,
  },
  resultOk: {
    marginTop: 18,
    padding: 12,
    borderRadius: 6,
    background: '#dcfce7',
    color: '#065f46',
    fontSize: 13,
  },
  resultErr: {
    marginTop: 18,
    padding: 12,
    borderRadius: 6,
    background: '#fef2f2',
    color: '#991b1b',
    fontSize: 13,
  },
} as const;

/** Default export: the Grand Idea capture form. */
export function GrandIdeaForm(props: GrandIdeaFormProps): JSX.Element {
  const {
    tenantSlug,
    projectId,
    initialPrompt = '',
    onCaptured,
    onError,
    apiBasePath = '/api',
    fetchImpl,
  } = props;
  const [prompt, setPrompt] = useState<string>(initialPrompt);
  const [result, setResult] = useState<FormResult>({ status: 'idle' });

  const fetchFn = useMemo<typeof fetch>(() => {
    if (fetchImpl) return fetchImpl;
    if (typeof fetch === 'function') return fetch;
    return (async () => {
      throw new Error('no fetch implementation available; pass fetchImpl');
    }) as unknown as typeof fetch;
  }, [fetchImpl]);

  const wordCount = computeWordCount(prompt);
  const tooShort = wordCount < GRAND_IDEA_WORD_FLOOR;
  const tooLong = wordCount > GRAND_IDEA_WORD_CEILING;
  const submitDisabled =
    tooShort || tooLong || result.status === 'submitting';

  const submit = useCallback(async () => {
    setResult({ status: 'submitting' });
    try {
      const res = await fetchFn(`${apiBasePath}/grand-idea`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantSlug, projectId, prompt }),
      });
      const body = (await res.json()) as CaptureResponse;
      if (body.ok === true) {
        setResult({
          status: 'success',
          message: `Idea captured (revision ${body.revisionNumber}).`,
        });
        onCaptured?.(body);
      } else {
        const failMsg = (body as { message?: string }).message ?? 'capture failed';
        setResult({ status: 'error', message: failMsg });
        onError?.(failMsg, body);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({ status: 'error', message });
      onError?.(message);
    }
  }, [apiBasePath, fetchFn, onCaptured, onError, projectId, prompt, tenantSlug]);

  return (
    <main style={styles.container} data-testid="grand-idea-form">
      <h1 style={styles.heading}>Tell me about your idea</h1>
      <p style={styles.subheading}>
        A paragraph or two is enough. The Interviewer will follow up with
        the structured questions — you don&apos;t need to anticipate them
        here.
      </p>

      <label htmlFor="grand-idea-prompt" style={styles.label}>
        Your idea
      </label>
      <textarea
        id="grand-idea-prompt"
        data-testid="grand-idea-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        style={styles.textarea}
        placeholder="e.g., A daily newsletter that surfaces the three most interesting open-source releases each morning, filtered by my GitHub stars graph."
      />
      <div style={styles.meta}>
        <span data-testid="word-count">{wordCount} words</span>
        {tooShort && (
          <span style={styles.metaError} data-testid="word-count-error">
            At least {GRAND_IDEA_WORD_FLOOR} words required
          </span>
        )}
        {tooLong && (
          <span style={styles.metaError} data-testid="word-count-error">
            At most {GRAND_IDEA_WORD_CEILING} words allowed
          </span>
        )}
      </div>

      <div style={styles.buttonRow}>
        <button
          type="button"
          data-testid="submit"
          disabled={submitDisabled}
          onClick={submit}
          style={submitDisabled ? styles.submitDisabled : styles.submit}
        >
          {result.status === 'submitting' ? 'Capturing…' : 'Capture grand idea'}
        </button>
      </div>

      {result.status === 'success' && result.message && (
        <div data-testid="result-ok" style={styles.resultOk}>
          {result.message}
        </div>
      )}
      {result.status === 'error' && result.message && (
        <div data-testid="result-err" style={styles.resultErr}>
          {result.message}
        </div>
      )}
    </main>
  );
}

export default GrandIdeaForm;
