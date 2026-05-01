'use client';

/**
 * FloatingPromptButton — bottom-right "submit a prompt" button +
 * Cmd+K shortcut wiring (DASH-011).
 *
 * Mounted in app/layout.tsx so it persists across every page.
 *
 * Spec: caia/docs/dashboard-ui-conventions.md §5.
 */

import { useEffect, useState } from 'react';
import { PromptModal } from './PromptModal';

const isMacLike = (() => {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || '');
})();

export function FloatingPromptButton() {
  const [open, setOpen] = useState(false);
  const [seedText, setSeedText] = useState<string>('');

  // Cmd+K / Ctrl+K to open modal.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isModK = (isMacLike ? e.metaKey : e.ctrlKey) && (e.key === 'k' || e.key === 'K');
      if (isModK) {
        e.preventDefault();
        setSeedText('');
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // "Ask CAIA about this →" tooltip on text selection (DASH-011 §3).
  // Implemented as a floating button anchored to the selection rect.
  useEffect(() => {
    let tip: HTMLButtonElement | null = null;

    function clearTip() {
      if (tip && tip.parentElement) tip.parentElement.removeChild(tip);
      tip = null;
    }

    function showTip(rect: DOMRect, selectedText: string) {
      clearTip();
      tip = document.createElement('button');
      tip.type = 'button';
      tip.textContent = '✨ Ask CAIA about this →';
      tip.style.cssText = [
        'position: absolute',
        `top: ${window.scrollY + rect.bottom + 6}px`,
        `left: ${window.scrollX + rect.left}px`,
        'background: #3182ce',
        'color: #f0f4f8',
        'border: none',
        'padding: 4px 8px',
        'border-radius: 6px',
        'font-size: 12px',
        'cursor: pointer',
        'z-index: 1100',
        'box-shadow: 0 2px 8px rgba(0,0,0,0.4)',
      ].join('; ');
      tip.addEventListener('click', () => {
        setSeedText(selectedText);
        setOpen(true);
        clearTip();
      });
      document.body.appendChild(tip);
    }

    function onUp() {
      // Avoid fighting the modal — if the user is selecting inside the
      // modal, suppress the tip.
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        clearTip();
        return;
      }
      const text = selection.toString().trim();
      if (!text || text.length < 4) {
        clearTip();
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      // Skip if selection is inside the modal itself.
      const node = range.commonAncestorContainer as HTMLElement;
      const inDialog = node && (node.closest ? node.closest('[role="dialog"]') : null);
      if (inDialog) {
        clearTip();
        return;
      }
      showTip(rect, text);
    }

    function onDown(e: MouseEvent) {
      // Clear if click outside selection / tip.
      if (tip && e.target === tip) return;
      clearTip();
    }

    document.addEventListener('mouseup', onUp);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mousedown', onDown);
      clearTip();
    };
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setSeedText('');
          setOpen(true);
        }}
        aria-label="Submit a prompt (⌘K)"
        title={isMacLike ? 'Submit a prompt (⌘K)' : 'Submit a prompt (Ctrl+K)'}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 300, // sit to the left of the 280px agent rail
          width: 52,
          height: 52,
          borderRadius: '50%',
          background: '#3182ce',
          color: '#f0f4f8',
          border: 'none',
          fontSize: 22,
          cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(49,130,206,0.45)',
          zIndex: 900,
        }}
      >
        💬
      </button>
      <PromptModal open={open} onClose={() => setOpen(false)} initialText={seedText} />
    </>
  );
}

export default FloatingPromptButton;
