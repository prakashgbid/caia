let toastEl: HTMLElement | null = null;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

function ensureToast(): HTMLElement {
  if (toastEl) return toastEl;

  toastEl = document.createElement('div');
  Object.assign(toastEl.style, {
    position: 'fixed',
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'rgba(0,0,0,0.9)',
    color: '#fff',
    fontFamily: 'Menlo, Consolas, monospace',
    fontSize: '12px',
    padding: '6px 12px',
    borderRadius: '4px',
    zIndex: '2147483647',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.15s ease',
    whiteSpace: 'nowrap',
  });
  document.body.appendChild(toastEl);
  return toastEl;
}

function showToast(msg: string): void {
  const el = ensureToast();
  el.textContent = msg;
  el.style.opacity = '1';

  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    toastTimer = null;
  }, 2000);
}

export async function copyId(id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(id);
  } catch {
    // Fallback for older browsers / insecure contexts
    const ta = document.createElement('textarea');
    ta.value = id;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  showToast(`Copied: ${id}`);
}

export function destroyToast(): void {
  if (toastEl) {
    document.body.removeChild(toastEl);
    toastEl = null;
  }
  if (toastTimer !== null) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
}
