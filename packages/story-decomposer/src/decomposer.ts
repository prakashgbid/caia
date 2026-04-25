import { nanoid } from 'nanoid';
import type { StoryNode, StoryKind, DecompositionTree, DecomposeOptions } from './types';

const KIND_ORDER: StoryKind[] = ['epic', 'story', 'sub_story', 'task', 'sub_task', 'todo'];

function makeId(): string {
  return 'st_' + nanoid(10);
}

function generateAcceptanceCriteria(kind: StoryKind, title: string, description: string): string[] {
  const criteria: string[] = [];
  const lower = (title + ' ' + description).toLowerCase();

  // Universal: existence
  criteria.push(`The ${title} must be implemented and reachable`);

  if (kind === 'todo') {
    criteria.push(`Implementation exists at the declared file path`);
    criteria.push(`TypeScript compiles without errors for this unit`);
  }

  if (lower.includes('page') || lower.includes('route') || lower.includes('url') || lower.includes('/')) {
    criteria.push(`The route returns HTTP 200 with a non-empty body (>500 bytes)`);
    criteria.push(`The page renders a <main> element with visible content`);
  }

  if (lower.includes('dashboard') || lower.includes('menu') || lower.includes('nav')) {
    criteria.push(`All navigation menu items are visible and have valid href attributes`);
    criteria.push(`Clicking each menu item navigates to its target route (non-404)`);
    criteria.push(`Each content section renders data or an explicit empty-state message — never a blank region`);
  }

  if (lower.includes('list') || lower.includes('grid') || lower.includes('table')) {
    criteria.push(`List/grid renders at least the expected number of items from the API`);
    criteria.push(`Empty state shows a descriptive message, not a blank panel`);
    criteria.push(`Each item is clickable and navigates to the correct detail page`);
  }

  if (lower.includes('button') || lower.includes('click') || lower.includes('action')) {
    criteria.push(`Each button/action element has a visible label`);
    criteria.push(`Clicking the element triggers the expected state change or navigation`);
  }

  if (lower.includes('api') || lower.includes('endpoint') || lower.includes('GET') || lower.includes('POST')) {
    criteria.push(`The endpoint returns the expected HTTP status code`);
    criteria.push(`The response body matches the declared schema`);
    criteria.push(`Invalid inputs return appropriate 4xx errors`);
  }

  if (lower.includes('test') || lower.includes('spec') || lower.includes('behavior')) {
    criteria.push(`The .behavior.ts test file exists at the declared path`);
    criteria.push(`All test cases in the file pass (0 failures)`);
    criteria.push(`Test covers the happy path and at least one error case`);
  }

  return criteria;
}

function generateVerificationPlan(kind: StoryKind, title: string, description: string): string[] {
  const plan: string[] = [];
  const lower = (title + ' ' + description).toLowerCase();

  if (lower.includes('file') || kind === 'todo') {
    plan.push(`file_exists: Check that all declared file paths exist on disk`);
  }

  if (lower.includes('page') || lower.includes('route') || lower.includes('url') || lower.includes('/')) {
    plan.push(`url_200: curl the page URL and verify 200 status + body > 500 bytes`);
    plan.push(`ui_region: Use dead-shell-detector to verify all data-test-region attributes have content`);
  }

  if (lower.includes('test') || lower.includes('behavior')) {
    plan.push(`test_pass: Run the associated .behavior.ts test suite — expect 100% pass`);
  }

  if (lower.includes('api') || lower.includes('endpoint')) {
    plan.push(`url_200: Verify all API endpoints return expected status codes`);
    plan.push(`test_pass: Run integration test for this endpoint`);
  }

  if (plan.length === 0) {
    plan.push(`manual: Review that ${title} meets its acceptance criteria`);
  }

  return plan;
}

function splitIntoStories(epicTitle: string, description: string): Array<{ title: string; description: string; kind: StoryKind }> {
  const stories: Array<{ title: string; description: string; kind: StoryKind }> = [];
  const lower = description.toLowerCase();

  // Detect major areas
  if (lower.includes('ui') || lower.includes('dashboard') || lower.includes('page') || lower.includes('frontend')) {
    stories.push({ title: `${epicTitle} — UI Layer`, description: `User interface components, pages, and navigation`, kind: 'story' });
  }
  if (lower.includes('api') || lower.includes('endpoint') || lower.includes('backend') || lower.includes('route')) {
    stories.push({ title: `${epicTitle} — API Layer`, description: `Backend endpoints, data processing, and business logic`, kind: 'story' });
  }
  if (lower.includes('database') || lower.includes('schema') || lower.includes('migration') || lower.includes('db')) {
    stories.push({ title: `${epicTitle} — Data Layer`, description: `Database schema, migrations, and data access patterns`, kind: 'story' });
  }
  if (lower.includes('test') || lower.includes('spec') || lower.includes('verify') || lower.includes('behavior')) {
    stories.push({ title: `${epicTitle} — Test Coverage`, description: `Behavior tests, integration tests, and verification`, kind: 'story' });
  }

  // Default if nothing matched
  if (stories.length === 0) {
    stories.push({ title: `${epicTitle} — Core Implementation`, description: description, kind: 'story' });
    stories.push({ title: `${epicTitle} — Integration`, description: `Wire up and integrate all components`, kind: 'story' });
  }

  return stories;
}

function generateSubStories(storyTitle: string, storyDescription: string): Array<{ title: string; description: string }> {
  const subs: Array<{ title: string; description: string }> = [];
  const lower = (storyTitle + ' ' + storyDescription).toLowerCase();

  if (lower.includes('ui') || lower.includes('page') || lower.includes('dashboard')) {
    subs.push({ title: `${storyTitle}: Page/Route Setup`, description: `Create the page component, set up routing, and establish layout` });
    subs.push({ title: `${storyTitle}: Data Loading`, description: `Fetch data from API, handle loading states and errors` });
    subs.push({ title: `${storyTitle}: Interactive Elements`, description: `Buttons, forms, click handlers, and navigation actions` });
    subs.push({ title: `${storyTitle}: Empty States`, description: `Empty state messages for all data regions — no blank panels allowed` });
  } else if (lower.includes('api') || lower.includes('endpoint')) {
    subs.push({ title: `${storyTitle}: Route Definition`, description: `Define route handler, path, method, and middleware` });
    subs.push({ title: `${storyTitle}: Input Validation`, description: `Validate and sanitize all inputs` });
    subs.push({ title: `${storyTitle}: Business Logic`, description: `Core processing and data transformation` });
    subs.push({ title: `${storyTitle}: Response Formatting`, description: `Shape response, handle errors, return correct status codes` });
  } else if (lower.includes('database') || lower.includes('schema')) {
    subs.push({ title: `${storyTitle}: Schema Definition`, description: `Table definitions, columns, types, and constraints` });
    subs.push({ title: `${storyTitle}: Migration File`, description: `SQL migration script` });
    subs.push({ title: `${storyTitle}: Indexes`, description: `Performance indexes for common query patterns` });
  } else {
    subs.push({ title: `${storyTitle}: Core Logic`, description: `Main implementation` });
    subs.push({ title: `${storyTitle}: Integration`, description: `Connect to the rest of the system` });
  }

  return subs;
}

function generateTasks(subStoryTitle: string): Array<{ title: string; description: string }> {
  return [
    { title: `Implement: ${subStoryTitle}`, description: `Write the actual code for ${subStoryTitle}` },
    { title: `Test: ${subStoryTitle}`, description: `Write behavior tests for ${subStoryTitle}` },
  ];
}

function generateTodos(taskTitle: string): Array<{ title: string; description: string }> {
  if (taskTitle.startsWith('Implement:')) {
    const subject = taskTitle.replace('Implement:', '').trim();
    return [
      { title: `Write ${subject} source file`, description: `Create the TypeScript source file` },
      { title: `Export ${subject} from package index`, description: `Add export to index.ts` },
    ];
  }
  if (taskTitle.startsWith('Test:')) {
    const subject = taskTitle.replace('Test:', '').trim();
    return [
      { title: `Write ${subject}.behavior.ts skeleton`, description: `Create the behavior test file with describe/it blocks` },
      { title: `Implement ${subject} happy-path test`, description: `Write and pass the primary test case` },
    ];
  }
  return [{ title: `Complete: ${taskTitle}`, description: `Finish implementation` }];
}

export function decompose(input: string, options: DecomposeOptions = {}): DecompositionTree {
  const { projectSlug = null, domainSlugs = [], maxDepth = 4 } = options;
  const nodes = new Map<string, StoryNode>();
  const orderedIds: string[] = [];

  function addNode(node: StoryNode): void {
    nodes.set(node.id, node);
    orderedIds.push(node.id);
  }

  // Epic
  const epicId = makeId();
  const epicTitle = input.length > 80 ? input.slice(0, 77) + '...' : input;
  addNode({
    id: epicId,
    parentId: null,
    prevSiblingId: null,
    nextSiblingId: null,
    ordinal: 0,
    kind: 'epic',
    title: epicTitle,
    description: input,
    expectedBehavior: `The complete feature described by: "${input}" is fully implemented, tested, and verified.`,
    acceptanceCriteria: generateAcceptanceCriteria('epic', epicTitle, input),
    verificationPlan: generateVerificationPlan('epic', epicTitle, input),
    behaviorTestPath: null,
    dependsOn: [],
    projectSlug,
    domainSlugs,
    status: 'pending',
  });

  if (maxDepth < 2) return { rootId: epicId, nodes, orderedIds };

  // Stories
  const storyDefs = splitIntoStories(epicTitle, input);
  const storyIds: string[] = [];
  for (let i = 0; i < storyDefs.length; i++) {
    const s = storyDefs[i];
    const storyId = makeId();
    storyIds.push(storyId);
    addNode({
      id: storyId,
      parentId: epicId,
      prevSiblingId: i > 0 ? storyIds[i - 1] : null,
      nextSiblingId: null, // filled below
      ordinal: i,
      kind: 'story',
      title: s.title,
      description: s.description,
      expectedBehavior: `${s.title} is fully implemented with no empty shells or placeholders.`,
      acceptanceCriteria: generateAcceptanceCriteria('story', s.title, s.description),
      verificationPlan: generateVerificationPlan('story', s.title, s.description),
      behaviorTestPath: null,
      dependsOn: [],
      projectSlug,
      domainSlugs,
      status: 'pending',
    });
    // Update prev sibling's next pointer
    if (i > 0) {
      const prev = nodes.get(storyIds[i - 1])!;
      prev.nextSiblingId = storyId;
    }
  }

  if (maxDepth < 3) return { rootId: epicId, nodes, orderedIds };

  // Sub-stories
  for (const storyId of storyIds) {
    const story = nodes.get(storyId)!;
    const subDefs = generateSubStories(story.title, story.description);
    const subIds: string[] = [];

    for (let i = 0; i < subDefs.length; i++) {
      const sub = subDefs[i];
      const subId = makeId();
      subIds.push(subId);
      addNode({
        id: subId,
        parentId: storyId,
        prevSiblingId: i > 0 ? subIds[i - 1] : null,
        nextSiblingId: null,
        ordinal: i,
        kind: 'sub_story',
        title: sub.title,
        description: sub.description,
        expectedBehavior: `${sub.title} is complete with no empty shells.`,
        acceptanceCriteria: generateAcceptanceCriteria('sub_story', sub.title, sub.description),
        verificationPlan: generateVerificationPlan('sub_story', sub.title, sub.description),
        behaviorTestPath: null,
        dependsOn: [],
        projectSlug,
        domainSlugs,
        status: 'pending',
      });
      if (i > 0) {
        const prev = nodes.get(subIds[i - 1])!;
        prev.nextSiblingId = subId;
      }

      if (maxDepth < 4) continue;

      // Tasks under sub-story
      const taskDefs = generateTasks(sub.title);
      const taskIds: string[] = [];
      for (let j = 0; j < taskDefs.length; j++) {
        const t = taskDefs[j];
        const taskId = makeId();
        taskIds.push(taskId);
        addNode({
          id: taskId,
          parentId: subId,
          prevSiblingId: j > 0 ? taskIds[j - 1] : null,
          nextSiblingId: null,
          ordinal: j,
          kind: 'task',
          title: t.title,
          description: t.description,
          expectedBehavior: `${t.title} — concrete implementation unit complete.`,
          acceptanceCriteria: generateAcceptanceCriteria('task', t.title, t.description),
          verificationPlan: generateVerificationPlan('task', t.title, t.description),
          behaviorTestPath: t.title.includes('Test') ? null : null,
          dependsOn: [],
          projectSlug,
          domainSlugs,
          status: 'pending',
        });
        if (j > 0) {
          const prev = nodes.get(taskIds[j - 1])!;
          prev.nextSiblingId = taskId;
        }

        if (maxDepth < 5) continue;

        // Todos under task
        const todoDefs = generateTodos(t.title);
        const todoIds: string[] = [];
        for (let k = 0; k < todoDefs.length; k++) {
          const td = todoDefs[k];
          const todoId = makeId();
          todoIds.push(todoId);
          addNode({
            id: todoId,
            parentId: taskId,
            prevSiblingId: k > 0 ? todoIds[k - 1] : null,
            nextSiblingId: null,
            ordinal: k,
            kind: 'todo',
            title: td.title,
            description: td.description,
            expectedBehavior: `${td.title} is done.`,
            acceptanceCriteria: generateAcceptanceCriteria('todo', td.title, td.description),
            verificationPlan: generateVerificationPlan('todo', td.title, td.description),
            behaviorTestPath: null,
            dependsOn: [],
            projectSlug,
            domainSlugs,
            status: 'pending',
          });
          if (k > 0) {
            const prev = nodes.get(todoIds[k - 1])!;
            prev.nextSiblingId = todoId;
          }
        }
      }
    }
  }

  return { rootId: epicId, nodes, orderedIds };
}
