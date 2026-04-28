/**
 * Registers Cmd+Shift+I (Meta+Shift+I) keybind to toggle the dev inspector panel.
 * Returns a cleanup function.
 */
export function registerKeybind(callback: () => void): () => void {
  function handler(e: KeyboardEvent): void {
    if (e.metaKey && e.shiftKey && e.key === 'I') {
      e.preventDefault();
      callback();
    }
  }

  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}
