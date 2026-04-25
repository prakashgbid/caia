import { getDomFiber, HOST_COMPONENT } from './fiberWalk';
import { buildIdFromFiber } from './format';

const ATTR = 'data-inspector-id';
let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function assignToElement(el: Element): void {
  const fiber = getDomFiber(el);
  if (!fiber) return;

  if (fiber.tag !== HOST_COMPONENT) return;

  const id = buildIdFromFiber(fiber);
  if (!id) return;

  const existing = el.getAttribute(ATTR);
  if (existing !== id) {
    el.setAttribute(ATTR, id);
  }
}

export function assignAllIds(root: Element = document.body): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node: Element | null = root;
  while (node) {
    assignToElement(node);
    node = walker.nextNode() as Element | null;
  }
}

function scheduleReassign(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    assignAllIds();
    debounceTimer = null;
  }, 100);
}

export function startObserver(): void {
  if (observer) return;
  observer = new MutationObserver(mutations => {
    const hasStructural = mutations.some(
      m => m.type === 'childList' && (m.addedNodes.length > 0 || m.removedNodes.length > 0)
    );
    if (hasStructural) scheduleReassign();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

export function stopObserver(): void {
  observer?.disconnect();
  observer = null;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function clearAllIds(): void {
  document.querySelectorAll(`[${ATTR}]`).forEach(el => el.removeAttribute(ATTR));
}
