'use client';

type ToggleFn = (on?: boolean) => void;

let toggle: ToggleFn | null = null;

function handleKeyDown(e: KeyboardEvent): void {
  if (e.altKey && (e.key === 'i' || e.key === 'I')) {
    e.preventDefault();
    toggle?.();
  }
}

export function registerKeybind(fn: ToggleFn): () => void {
  toggle = fn;
  document.addEventListener('keydown', handleKeyDown);
  return () => {
    document.removeEventListener('keydown', handleKeyDown);
    toggle = null;
  };
}
