import { nanoid } from 'nanoid';
import type { DecompositionNode, DecompositionResult, DecomposerConfig } from './types.js';

function estimateEffort(description: string): 'trivial' | 'small' | 'medium' | 'large' | 'xl' {
  const words = description.split(/\s+/).length;
  if (words < 5) return 'trivial';
  if (words < 15) return 'small';
  if (words < 30) return 'medium';
  if (words < 60) return 'large';
  return 'xl';
}

// Extract logical sections from a prompt using heuristics
function extractSections(prompt: string): string[] {
  // Split on common separators: newlines, "and", semicolons, commas in lists
  const lines = prompt.split(/\n+/).filter(l => l.trim().length > 5);
  if (lines.length > 1) return lines.map(l => l.trim());

  // Single line — split on conjunctions
  const parts = prompt.split(/,\s+(?:and\s+)?|\s+and\s+|\s*;\s*/i).filter(p => p.trim().length > 3);
  return parts.length > 1 ? parts : [prompt];
}

export function decomposeRuleBased(prompt: string, _config: DecomposerConfig = {}): DecompositionResult {
  const sections = extractSections(prompt);

  // Create one Initiative for the whole prompt
  const initiative: DecompositionNode = {
    id: `init-${nanoid(6)}`,
    level: 'initiative',
    title: prompt.length > 60 ? prompt.slice(0, 57) + '...' : prompt,
    description: prompt,
    estimatedEffort: 'large',
    children: [],
  };

  // Create one Epic per major section
  const epics: DecompositionNode[] = sections.map((section, i) => {
    const epicId = `epic-${nanoid(6)}`;

    // Create 2-4 stories per epic
    const storyCount = Math.min(Math.max(2, Math.ceil(section.split(/\s+/).length / 10)), 4);
    const stories: DecompositionNode[] = [];

    const storyTemplates = [
      `Implement core ${section.slice(0, 30)} functionality`,
      `Add UI/UX for ${section.slice(0, 30)}`,
      `Write tests for ${section.slice(0, 30)}`,
      `Document ${section.slice(0, 30)} implementation`,
    ];

    for (let s = 0; s < storyCount; s++) {
      const storyId = `story-${nanoid(6)}`;
      const storyTitle = storyTemplates[s] ?? `Implement ${section.slice(0, 30)} part ${s + 1}`;

      // Create 2 tasks per story
      const tasks: DecompositionNode[] = [
        {
          id: `task-${nanoid(6)}`,
          level: 'task',
          title: `${storyTitle} — implementation`,
          description: `Write the code for: ${storyTitle}`,
          estimatedEffort: 'small',
          canParallelize: false,
        },
        {
          id: `task-${nanoid(6)}`,
          level: 'task',
          title: `${storyTitle} — tests`,
          description: `Write unit and integration tests for: ${storyTitle}`,
          estimatedEffort: 'small',
          canParallelize: false,
        },
      ];

      stories.push({
        id: storyId,
        level: 'story',
        title: storyTitle,
        description: `As a user, I want to ${section} so that I can achieve my goal.`,
        acceptanceCriteria: [
          `The ${section.slice(0, 30)} feature works as expected`,
          'All tests pass',
        ],
        estimatedEffort: estimateEffort(section),
        canParallelize: s > 0, // First story is foundational, rest can parallelize
        children: tasks,
      });
    }

    return {
      id: epicId,
      level: 'epic',
      title: `Epic ${i + 1}: ${section.slice(0, 50)}`,
      description: section,
      estimatedEffort: 'large',
      canParallelize: i > 0,
      children: stories,
    };
  });

  initiative.children = epics;

  const countDescendants = (nodes: DecompositionNode[]): number =>
    nodes.reduce((sum, n) => sum + 1 + countDescendants(n.children ?? []), 0);

  const totalNodes = 1 + countDescendants(epics);

  return {
    originalPrompt: prompt,
    hierarchy: [initiative],
    totalNodes,
    estimatedDays: epics.length * 3,
    recommendedParallelTracks: Math.min(epics.length, 3),
    summary: `Decomposed into ${epics.length} epic(s) with ${totalNodes} total nodes. Estimated ${epics.length * 3} days.`,
  };
}
