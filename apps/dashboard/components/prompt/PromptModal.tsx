'use client';

/**
 * PromptModal — the modal used by the floating prompt button + inline
 * `+` triggers + Cmd+K (DASH-011).
 *
 * Sends POST /api/prompts with `metadata.context` derived from the
 * current URL via usePromptContext. The CAIA pipeline (PO → BA → EA …)
 * processes the prompt; metadata.context becomes a hint to PO's
 * scope-detector.
 *
 * Spec: caia/docs/dashboard-ui-conventions.md §5.
 */

import { useEffect, useRef, useState } from 'react';
import { usePromptContext, type PromptContext } from '../../hooks/usePromptContext';

const HISTORY_KEY = 'prompt-history';
const HISTORY_MAX = 5;

const RUN_MODES = ['plan-only', 'test-only', 'full'] as const;
type RunMode = typeof RUN_MODES[number];

const SCOPES = ['initiative', 'epic', 'module', 'story', 'task', 'subtask', 'auto'] as const;
type Scope = typeof SCOPES[number];

interface PromptModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional pre-fill (e.g. selected text or row context). */
  initialText?: string;
  /** Optional context overrides (e.g. when triggered from a row). */
  contextOverride?: Partial<PromptContext>;
}

interface HistoryEntry {
  text: string;
  ts: number;
}

function readHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.slice(0, HISTORY_MAX) as HistoryEntry[];
    return [];
  } catch {
    return [];
  }
}

function appendHistory(text: string) {
  if (typeof window === 'undefined') return;
  try {
    const cur = readHistory();
    const next: HistoryEntry[] = [{ text, ts: Date.now() }, ...cur.filter((e) => e.text !== text)].slice(0, HISTORY_MAX);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function PromptModal({ open, onClose, initialText = '', contextOverride }: PromptModalProps) {
  const ctx = usePromptContext();
  const mergedContext: PromptContext = { ...ctx, ...(contextOverride ?? {}) };
  const [text, setText] = useState(initialText);
  const [runMode, setRunMode] = useState<RunMode>('full');
  const [scope, setScope] = useState<Scope>('auto');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setText(initialText);
      setErr(null);
      setOk(null);
      setHistory(readHistory());
      // Focus next tick.
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [open, initialText]);

  // Esc to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit() {
    if (!text.trim()) return;
    setSubmitting(true);
    setErr(null);
    setOk(null);
    try {
      const body = {
        text: text.trim(),
        run_mode: runMode,
        ...(scope !== 'auto' ? { scope } : {}),
        metadata: { context: mergedContext },
      };
      const r = await fetch('/api/prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const msg = await r.text().catch(() => `HTTP ${r.status}`);
        throw new Error(msg || `HTTP ${r.status}`);
      }
      const data = (await r.json()) as { prompt_id?: string };
      appendHistory(text.trim());
      setOk(data.prompt_id ? `Submitted as ${data.prompt_id}` : 'Submitted');
      setText('');
      setTimeout(() => onClose(), 800);
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Submit a prompt"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '10vh 16px 16px',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: 'min(680px, 100%)',
          background: '#1a1f2e',
          border: '1px solid #2d3748',
          borderRadius: 12,
          padding: 16,
          color: '#f0f4f8',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>💬 Submit a prompt</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'transparent', border: 'none', color: '#a0aec0', fontSize: 18, cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <div style={{ fontSize: 11, color: '#718096', marginBottom: 8 }}>
          From: <span style={{ color: '#90cdf4' }}>{mergedContext.submittedFrom}</span>
          {Object.keys(mergedContext.scope_hint).length > 0 && (
            <>
              {' • Hint:'}{' '}
              {Object.entries(mergedContext.scope_hint).map(([k, v]) => (
                <span key={k} style={{ marginRight: 8, color: '#cbd5e0' }}>
                  <code>{k}={v}</code>
                </span>
              ))}
            </>
          )}
        </div>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Ask CAIA to do something. Context (URL, parents, filters) is auto-attached."
          style={{
            width: '100%',
            background: '#0f1117',
            border: '1px solid #2d3748',
            borderRadius: 8,
            padding: 10,
            color: '#f0f4f8',
            fontSize: 14,
            fontFamily: 'inherit',
            resize: 'vertical',
            boxSizing: 'border-box',
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
        />

        <div style={{ display: 'flex', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#a0aec0', display: 'flex', alignItems: 'center', gap: 6 }}>
            Run mode
            <select
              value={runMode}
              onChange={(e) => setRunMode(e.target.value as RunMode)}
              style={{
                background: '#0f1117',
                color: '#f0f4f8',
                border: '1px solid #2d3748',
                borderRadius: 6,
                padding: '4px 6px',
                fontSize: 12,
              }}
            >
              {RUN_MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 12, color: '#a0aec0', display: 'flex', alignItems: 'center', gap: 6 }}>
            Scope
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Scope)}
              style={{
                background: '#0f1117',
                color: '#f0f4f8',
                border: '1px solid #2d3748',
                borderRadius: 6,
                padding: '4px 6px',
                fontSize: 12,
              }}
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <div style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'transparent',
              border: '1px solid #2d3748',
              color: '#a0aec0',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !text.trim()}
            style={{
              background: submitting || !text.trim() ? '#2d3748' : '#3182ce',
              border: 'none',
              color: '#f0f4f8',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              cursor: submitting || !text.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting ? 'Submitting…' : 'Submit (⌘↵)'}
          </button>
        </div>

        {err && <div style={{ marginTop: 10, color: '#fc8181', fontSize: 12 }}>Error: {err}</div>}
        {ok && <div style={{ marginTop: 10, color: '#68d391', fontSize: 12 }}>{ok}</div>}

        {history.length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #2d3748' }}>
            <div style={{ fontSize: 10, color: '#718096', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
              Recent prompts
            </div>
            {history.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setText(h.text)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: 'transparent',
                  border: '1px solid #2d3748',
                  borderRadius: 6,
                  padding: '6px 8px',
                  marginBottom: 4,
                  color: '#cbd5e0',
                  fontSize: 12,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={h.text}
              >
                {h.text}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PromptModal;
