'use client';

import { assignAllIds } from './id/assignIds';

const ATTR = 'data-inspector-id';

export interface DevInspectorAPI {
  find(id: string): HTMLElement | null;
  highlight(id: string): void;
  list(): string[];
  toggle(on?: boolean): void;
}

declare global {
  interface Window {
    __devInspector?: DevInspectorAPI;
  }
}

let toggleFn: ((on?: boolean) => void) | null = null;

export function registerGlobalApi(toggle: (on?: boolean) => void): void {
  toggleFn = toggle;

  window.__devInspector = {
    find(id) {
      return document.querySelector<HTMLElement>(`[${ATTR}="${CSS.escape(id)}"]`);
    },

    highlight(id) {
      const el = this.find(id);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const prev = el.style.outline;
      const prevTransition = el.style.transition;
      el.style.transition = 'outline 0s';
      el.style.outline = '3px solid #DC2626';
      setTimeout(() => {
        el.style.outline = prev;
        el.style.transition = prevTransition;
      }, 1500);
    },

    list() {
      return Array.from(document.querySelectorAll(`[${ATTR}]`)).map(
        el => el.getAttribute(ATTR)!
      );
    },

    toggle(on) {
      toggleFn?.(on);
    },
  };
}

export function unregisterGlobalApi(): void {
  delete window.__devInspector;
  toggleFn = null;
}

export function refreshIds(): void {
  assignAllIds();
}
