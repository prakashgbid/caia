/**
 * /api/chat — Vercel AI SDK-compatible chat streaming endpoint.
 *
 * Wave 1.3 of the Enterprise Wave 1 campaign per
 * `agent/memory/enterprise_ai_landscape_directive.md` (W1-2-add). Adds
 * an agent-native chat surface to the operator dashboard.
 *
 * The routing taxonomy + orchestrator forwarding + AI-SDK encoders all
 * live in `lib/chat/routing.ts` so the route file exposes ONLY the
 * Next.js handler exports (Next 14's app router rejects non-handler
 * exports from `route.ts`).
 *
 * Subscription-only LLM constraint preserved: this endpoint NEVER calls
 * Anthropic's API. The synthesised response is fully local. Operators
 * who want true LLM-backed chat can swap the streamer for `streamText`
 * with an `ollama:llama3.2:3b` provider locally.
 */

import { type NextRequest } from 'next/server';

import {
  buildAssistantText,
  encodeFinishMessage,
  encodeTextChunk,
  maybeForwardToOrchestrator,
  routeMessage
} from '../../../lib/chat/routing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequestBody {
  messages: ChatMessage[];
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const last = [...body.messages].reverse().find((m) => m.role === 'user');
  if (!last) {
    return new Response(JSON.stringify({ error: 'no user message in payload' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const decision = routeMessage(last.content);
  const promptIdInfo = await maybeForwardToOrchestrator(last.content);
  const lines = buildAssistantText(decision, promptIdInfo);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const line of lines) {
          controller.enqueue(encoder.encode(encodeTextChunk(line + '\n')));
          // Tiny delay so the operator sees real streaming UX. Cap total
          // latency at well under a second so tests stay fast.
          await new Promise((r) => setTimeout(r, 30));
        }
        const promptTokens = last.content.length;
        const completionTokens = lines.join('\n').length;
        controller.enqueue(encoder.encode(encodeFinishMessage(promptTokens, completionTokens)));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    }
  });

  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'X-Vercel-AI-Data-Stream': 'v1',
    'X-Caia-Routed-Agent': decision.agent,
    'X-Caia-Classification': decision.classification,
    'X-Caia-Forwarded': promptIdInfo.forwarded ? '1' : '0'
  };
  if (promptIdInfo.promptId) {
    headers['X-Caia-Prompt-Id'] = promptIdInfo.promptId;
  }

  return new Response(stream, { headers });
}
