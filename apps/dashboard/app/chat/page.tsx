/**
 * /chat — operator chat page.
 *
 * Wave 1.3 of the Enterprise Wave 1 campaign per
 * `agent/memory/enterprise_ai_landscape_directive.md` (W1-2-add).
 */

import type { JSX } from 'react';
import { ChatPanel } from '../../components/chat/ChatPanel';

export const dynamic = 'force-dynamic';

export default function ChatPage(): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h1 style={{ margin: 0, fontSize: 22, color: '#f0f4f8' }}>Chat</h1>
      <p style={{ margin: 0, fontSize: 13, color: '#a0aec0', maxWidth: 720 }}>
        Operator chat surface. Messages are routed to one of the 10 canonical CAIA subagents
        (caia-po / ba / ea / validator / test-design / coding / fix-it / steward / mentor / curator)
        using the deterministic local routing taxonomy. When{' '}
        <code style={{ background: '#1a1f2e', padding: '2px 6px', borderRadius: 3 }}>
          CAIA_ORCHESTRATOR_URL
        </code>{' '}
        is set, prompts are also forwarded to the live orchestrator and surface in the prompt
        journey UI.
      </p>
      <ChatPanel />
    </div>
  );
}
