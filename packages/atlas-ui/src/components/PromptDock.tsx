/**
 * `<PromptDock>` — per-scope prompt input + version history.
 *
 * Spec §4. Sits anchored to the bottom of the design pane when a
 * ticket is selected. Submit binds to `Cmd+Enter`; plain `Enter`
 * inserts a newline (operators paste multi-paragraph requirements).
 */

import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import type {
  AtlasSubmitPromptRequest,
  AtlasSubmitPromptResponse,
  AtlasTicketVersion,
} from '../types/index.js';

export interface PromptDockProps {
  /** The currently primary-selected ticket. Null hides the dock. */
  selection: {
    ticketId: string;
    title: string;
    level: string;
  } | null;
  /** Total count of selected tickets — for "3 tickets selected" header. */
  selectedCount: number;
  /** Fired on submit. Host should call `client.submitPrompt`. */
  onSubmit?: (
    body: AtlasSubmitPromptRequest,
  ) => Promise<AtlasSubmitPromptResponse> | AtlasSubmitPromptResponse;
  /** Fired on close (X button). */
  onClose?: () => void;
  /** History rows (pre-fetched). When omitted, the history button hides. */
  history?: AtlasTicketVersion[];
  /** Optional initial text. */
  initialText?: string;
  /** Show submitting spinner. */
  submitting?: boolean;
  /** Show error banner. */
  error?: string | null;
}

export function PromptDock(props: PromptDockProps): React.ReactElement | null {
  const [text, setText] = useState(props.initialText ?? '');
  const [historyOpen, setHistoryOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Focus on selection change.
  useEffect(() => {
    if (props.selection && taRef.current) {
      taRef.current.focus();
    }
  }, [props.selection?.ticketId]);

  if (!props.selection) return null;

  const handleSubmit = (): void => {
    if (!text.trim() || !props.onSubmit) return;
    const body: AtlasSubmitPromptRequest = {
      prompt: text,
      selection: [props.selection!.ticketId],
      ts: new Date().toISOString(),
      promptGroupId: null,
    };
    Promise.resolve(props.onSubmit(body))
      .then(() => setText(''))
      .catch(() => {
        // Errors surface via the `error` prop; nothing to do here.
      });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      props.onClose?.();
    }
  };

  const headerTitle =
    props.selectedCount > 1
      ? `${props.selectedCount} tickets selected`
      : `${props.selection.title} · ${props.selection.level}`;

  return (
    <form
      className="atlas-prompt-dock"
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      aria-label="Submit a change request for the selected ticket"
      role="region"
      data-testid="atlas-prompt-dock"
    >
      <header className="atlas-prompt-dock__header">
        <span className="atlas-prompt-dock__title">
          <span className="atlas-prompt-dock__id">{props.selection.ticketId}</span>
          <span>{headerTitle}</span>
        </span>
        <button
          type="button"
          className="atlas-prompt-dock__close"
          aria-label="Close prompt dock"
          onClick={() => props.onClose?.()}
          data-testid="atlas-prompt-close"
        >
          ×
        </button>
      </header>
      <label htmlFor="atlas-prompt-input" className="atlas-sr-only">
        Change request
      </label>
      <textarea
        ref={taRef}
        id="atlas-prompt-input"
        className="atlas-prompt-dock__textarea"
        placeholder="Type your change request…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-describedby="atlas-prompt-hint"
        rows={3}
        disabled={props.submitting}
        data-testid="atlas-prompt-input"
      />
      {props.error ? (
        <div role="alert" style={{ padding: '6px 12px', color: 'var(--atlas-danger)', fontSize: 12 }}>
          {props.error}
        </div>
      ) : null}
      <footer className="atlas-prompt-dock__footer">
        <span id="atlas-prompt-hint" className="atlas-sr-only">
          Press Command-Enter to submit.
        </span>
        <button
          type="button"
          className="atlas-prompt-dock__history-btn"
          aria-expanded={historyOpen}
          aria-controls="atlas-prompt-history"
          onClick={() => setHistoryOpen((v) => !v)}
          disabled={!props.history || props.history.length === 0}
          data-testid="atlas-prompt-history-toggle"
        >
          History ({props.history?.length ?? 0})
        </button>
        <div className="atlas-prompt-dock__actions">
          <button
            type="button"
            className="atlas-prompt-dock__btn"
            onClick={() => props.onClose?.()}
            disabled={props.submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="atlas-prompt-dock__btn atlas-prompt-dock__btn--primary"
            disabled={!text.trim() || props.submitting}
            data-testid="atlas-prompt-submit"
          >
            {props.submitting ? 'Submitting…' : 'Submit ⌘↵'}
          </button>
        </div>
      </footer>
      {historyOpen && props.history && props.history.length > 0 ? (
        <ul
          id="atlas-prompt-history"
          className="atlas-prompt-dock__history"
          role="list"
          data-testid="atlas-prompt-history"
        >
          {props.history.map((v) => (
            <li key={v.id} className="atlas-prompt-dock__history-item">
              <span className="atlas-prompt-dock__version">v{v.versionNumber}</span>
              <span>
                <strong>{v.prompt}</strong>
                <br />
                <small style={{ color: 'var(--atlas-text-muted)' }}>
                  {v.previousState} → {v.newState} · {v.createdAt.slice(0, 16).replace('T', ' ')}
                </small>
              </span>
              <span>
                {v.resolutionPrUrl ? (
                  <a
                    href={v.resolutionPrUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--atlas-info)' }}
                  >
                    PR
                  </a>
                ) : (
                  <span style={{ color: 'var(--atlas-text-faint)' }}>—</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

PromptDock.displayName = 'PromptDock';
