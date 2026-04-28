import type { DecompositionResult, DecomposerConfig } from './types.js';

const DECOMPOSER_SYSTEM_PROMPT = `You are an expert product manager and software architect. Your job is to decompose user requirements into a structured hierarchy of work items.

Given a prompt from a user, produce a JSON hierarchy with this exact structure:
{
  "hierarchy": [
    {
      "id": "init-1",
      "level": "initiative",
      "title": "Short initiative title",
      "description": "What this initiative achieves",
      "estimatedEffort": "large",
      "children": [
        {
          "id": "epic-1",
          "level": "epic",
          "title": "Epic title",
          "description": "What this epic delivers",
          "estimatedEffort": "medium",
          "canParallelize": false,
          "children": [
            {
              "id": "story-1",
              "level": "story",
              "title": "User story title",
              "description": "As a user, I want to... so that...",
              "acceptanceCriteria": ["Criterion 1", "Criterion 2"],
              "estimatedEffort": "small",
              "canParallelize": false,
              "children": [
                {
                  "id": "task-1",
                  "level": "task",
                  "title": "Specific implementation task",
                  "description": "Detailed what needs to be done",
                  "estimatedEffort": "trivial",
                  "canParallelize": true
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}

Rules:
1. Use realistic IDs (init-1, epic-1, story-1, task-1 etc)
2. Keep titles short and actionable
3. Acceptance criteria should be testable
4. Set canParallelize: true only for items with no dependencies on siblings
5. estimatedEffort: trivial (<2h), small (2-8h), medium (1-3d), large (3-10d), xl (>10d)
6. Aim for 1-3 initiatives, 2-5 epics per initiative, 2-6 stories per epic, 1-4 tasks per story
7. Return ONLY valid JSON, no markdown, no explanation`;

export async function decomposeWithClaude(prompt: string, config: DecomposerConfig = {}): Promise<DecompositionResult> {
  const apiKey = config.claudeApiKey ?? process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for Claude decomposition');

  const model = config.claudeModel ?? 'claude-sonnet-4-6';

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      system: DECOMPOSER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `Decompose this requirement:\n\n${prompt}` }],
    }),
  });

  if (!response.ok) throw new Error(`Claude API error: ${response.status}`);

  const data = await response.json() as { content: Array<{ type: string; text: string }> };
  const text = data.content.find((c) => c.type === 'text')?.text ?? '{}';

  let parsed: { hierarchy: DecompositionResult['hierarchy'] };
  try {
    parsed = JSON.parse(text) as { hierarchy: DecompositionResult['hierarchy'] };
  } catch {
    // Try to extract JSON from response
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Failed to parse Claude decomposition response');
    parsed = JSON.parse(match[0]) as { hierarchy: DecompositionResult['hierarchy'] };
  }

  const countNodes = (nodes: DecompositionResult['hierarchy']): number =>
    nodes.reduce((sum, n) => sum + 1 + countNodes(n.children ?? []), 0);

  const totalNodes = countNodes(parsed.hierarchy);
  const initiatives = parsed.hierarchy;
  const allEpics = initiatives.flatMap(i => i.children ?? []);

  return {
    originalPrompt: prompt,
    hierarchy: parsed.hierarchy,
    totalNodes,
    estimatedDays: allEpics.length * 2.5,
    recommendedParallelTracks: Math.min(allEpics.length, 4),
    summary: `AI decomposed into ${initiatives.length} initiative(s), ${allEpics.length} epic(s), ${totalNodes} total nodes.`,
  };
}
