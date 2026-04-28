// Daily story backfiller — scans for conductor entities without story decomposition + fills them
const CONDUCTOR_API = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

async function backfill(): Promise<void> {
  console.log(`[story-backfiller] ${new Date().toISOString()} starting`);

  // Get all existing story root IDs (epics linked to requirements)
  const storiesRes = await fetch(`${CONDUCTOR_API}/stories?root=true`);
  const existingStories = storiesRes.ok ? await storiesRes.json() as Array<{ id: string }> : [];
  const existingIds = new Set(existingStories.map(s => s.id));

  // Get all requirements
  const reqsRes = await fetch(`${CONDUCTOR_API}/requirements`);
  if (!reqsRes.ok) { console.log('[story-backfiller] Could not fetch requirements'); return; }
  const reqs = await reqsRes.json() as Array<{ id: string; title: string; description: string; projectId?: string }>;

  let decomposed = 0;
  for (const req of reqs) {
    if (existingIds.has(req.id)) continue; // Already decomposed

    // Create a minimal Epic node for this requirement
    const epicRes = await fetch(`${CONDUCTOR_API}/stories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'epic',
        title: req.title.slice(0, 120),
        description: req.description ?? '',
        expected_behavior: `${req.title} is fully implemented, tested, and verified.`,
        acceptance_criteria: [
          `${req.title} meets its stated requirements`,
          `Implementation is verifiable (file exists, URL 200, or test passes)`,
          `No empty shells or placeholder components`,
        ],
        verification_plan: [
          `manual: Review that ${req.title} meets acceptance criteria`,
          `file_exists: Check all declared file paths exist`,
        ],
        project_slug: req.projectId ?? null,
        status: 'pending',
        last_decomposed_at: new Date().toISOString(),
      }),
    });
    if (epicRes.ok) decomposed++;
  }

  console.log(`[story-backfiller] Created ${decomposed} epic nodes for ${reqs.length} requirements`);

  // Also post a timeline event
  await fetch(`${CONDUCTOR_API}/timeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'story.backfill',
      actor: 'system',
      summary: `Story backfiller: created ${decomposed} new epics from ${reqs.length} requirements`,
      subjectId: 'backfiller',
      subjectKind: 'system',
      payload: { decomposed, total: reqs.length },
    }),
  }).catch(() => {});
}

backfill().catch(console.error);
