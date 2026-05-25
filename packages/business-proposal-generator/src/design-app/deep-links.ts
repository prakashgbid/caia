/** Per-target deep-link URL builder. Per spec §5.2. */

import type { TargetName } from '../types/proposal.js';

/**
 * Returns the URL to open for "Send to <target>". Some targets do not
 * support a `?q=` prompt param; for those we return the homepage URL
 * and the caller renders a "Open <target> + Copy" two-action surface.
 */
export function buildDeepLink(target: TargetName, prompt: string): string {
  const encoded = encodeURIComponent(prompt);
  switch (target) {
    case 'claude_design':
      return `https://claude.ai/new?q=${encoded}`;
    case 'v0':
      return `https://v0.dev/chat?q=${encoded}`;
    case 'bolt':
      return `https://bolt.new/?prompt=${encoded}`;
    case 'figma':
      return 'https://www.figma.com/files/recent';
    case 'lovable':
      return 'https://lovable.dev/projects/new';
    case 'builderio':
      return 'https://builder.io/content/new';
    case 'webflow':
      return 'https://webflow.com/ai';
  }
}

/** True if the target supports inline `?q=`/`?prompt=` deep-link. */
export function supportsInlinePrompt(target: TargetName): boolean {
  return target === 'claude_design' || target === 'v0' || target === 'bolt';
}
