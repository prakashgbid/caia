import type { BlockersManager } from '../blockers/manager';
import type { QuestionsManager } from '../questions/manager';

// Idempotent seed — checks by title before creating
export async function seedData(
  blockersManager: BlockersManager,
  questionsManager: QuestionsManager,
): Promise<void> {
  const existingBlockerTitles = new Set(blockersManager.list().map((b) => b.title));
  const existingQuestionTitles = new Set(questionsManager.list().map((q) => q.title));

  // ─── Blockers ──────────────────────────────────────────────────────────────

  if (!existingBlockerTitles.has('Add DNS CNAME for roulettecommunity.com') &&
      !existingBlockerTitles.has('Add DNS CNAME records for roulettecommunity.com')) {
    await blockersManager.seedFromRecord({
      title: 'Add DNS CNAME records for roulettecommunity.com',
      state: 'open',
      severity: 'high',
      kind: 'dns',
      description:
        'The roulette community domain needs DNS CNAME records pointing apex + www to Cloudflare Pages before the site can go live.',
      resolutionSteps: [
        {
          order: 1,
          instruction:
            'Log in to your DNS provider (e.g. Namecheap / Cloudflare / Route53) for roulettecommunity.com.',
          verification: 'You can see the DNS management panel for the domain.',
        },
        {
          order: 2,
          instruction:
            'Add a CNAME record: Name = "@" (apex) or use ALIAS/ANAME if your provider supports it, Value = roulette-community.pages.dev, Proxied = ON.',
          verification: 'Record appears in your DNS zone list.',
        },
        {
          order: 3,
          instruction:
            'Add a second CNAME record: Name = "www", Value = roulette-community.pages.dev, Proxied = ON.',
          verification: 'Both records are saved.',
        },
        {
          order: 4,
          instruction:
            'Wait 1–5 minutes for propagation, then verify: `curl -I https://roulettecommunity.com` should return HTTP 200.',
          verification: 'curl returns 200 and the Cloudflare Pages site loads.',
        },
      ],
      links: [
        { label: 'Cloudflare Pages dashboard', url: 'https://dash.cloudflare.com/' },
      ],
    });
  }

  if (!existingBlockerTitles.has('Create 2 GA4 Properties in Google Analytics') &&
      !existingBlockerTitles.has('Create 2 GA4 Properties + paste Measurement IDs')) {
    await blockersManager.seedFromRecord({
      title: 'Create 2 GA4 Properties + paste Measurement IDs',
      state: 'open',
      severity: 'normal',
      kind: 'external-setup',
      description:
        'Two Google Analytics 4 properties must be created manually in the GA4 UI. Measurement IDs need to be pasted into the project config before analytics tracking goes live.',
      resolutionSteps: [
        {
          order: 1,
          instruction:
            'Go to analytics.google.com → Admin → Create Property. Name it "Stolution Production". Select web platform, enter the production domain.',
          verification: 'Property created; you see a Measurement ID (G-XXXXXXXX).',
        },
        {
          order: 2,
          instruction:
            'Repeat for "Roulette Community". Same steps, different domain.',
          verification: 'Second Measurement ID visible.',
        },
        {
          order: 3,
          instruction:
            'Copy both Measurement IDs and paste them into the project .env file under NEXT_PUBLIC_GA_STOLUTION and NEXT_PUBLIC_GA_ROULETTE respectively.',
          verification: 'Both variables present in .env.',
        },
        {
          order: 4,
          instruction:
            'Redeploy the apps so the new env vars are picked up, then open each site and confirm real-time events appear in the GA4 dashboard within 30 s.',
          verification: 'GA4 real-time report shows active users.',
        },
      ],
      links: [
        { label: 'Google Analytics', url: 'https://analytics.google.com/' },
      ],
    });
  }

  if (!existingBlockerTitles.has('Enable Cloudflare R2 in dashboard (one-time)')) {
    await blockersManager.seedFromRecord({
      title: 'Enable Cloudflare R2 in dashboard (one-time)',
      state: 'resolved',
      severity: 'normal',
      kind: 'approval',
      description:
        'Cloudflare R2 object storage must be enabled once via the Cloudflare dashboard before the R2 API can be used programmatically.',
      resolutionSteps: [
        {
          order: 1,
          instruction:
            'Log into dash.cloudflare.com → R2 Object Storage → Enable R2 (requires credit card on file).',
          verification: 'R2 dashboard shows "Create bucket" button.',
        },
      ],
      links: [
        { label: 'Cloudflare R2', url: 'https://dash.cloudflare.com/?to=/:account/r2' },
      ],
      resolvedAt: new Date().toISOString(),
      resolvedBy: 'user',
      resolutionNote: 'R2 enabled on 2026-04-18. Bucket created and API tokens issued.',
    });
  }

  // ─── Questions ─────────────────────────────────────────────────────────────

  if (!existingQuestionTitles.has('Conductor auto-kill of stalled tasks — enable by default or keep opt-in?') &&
      !existingQuestionTitles.has('Conductor pump auto-kill of stalled tasks — enable by default?')) {
    await questionsManager.seedFromRecord({
      title: 'Conductor pump auto-kill of stalled tasks — enable by default?',
      state: 'open',
      priority: 'normal',
      context:
        'Conductor can automatically cancel tasks that have been "running" for longer than a configurable TTL (default proposal: 30 min). ' +
        'This prevents zombie tasks from blocking file locks indefinitely. ' +
        'The question is whether this should be ON by default for all users, or require explicit opt-in via config.',
      recommendations: [
        {
          id: 'rec_A',
          label: 'Enable by default (30 min TTL, configurable)',
          rationale:
            'Eliminates the most common pain point (stuck locks) without any config. Users who need longer tasks can raise the TTL.',
          isDefault: true,
        },
        {
          id: 'rec_B',
          label: 'Opt-in — default OFF, enable via CONDUCTOR_AUTO_KILL_TTL env var',
          rationale:
            'Safer for users running genuinely long tasks (e.g. large builds or DB migrations). Avoids surprise cancellations.',
        },
        {
          id: 'rec_C',
          label: 'Enable by default with a longer TTL (2 hours) and a clear warning in logs',
          rationale:
            'Middle ground — protects against runaway tasks but rarely affects legitimate long-running work.',
        },
      ],
      customAnswerPlaceholder: 'Describe a different TTL, trigger condition, or rollout approach...',
    });
  }

  if (!existingQuestionTitles.has('Pixabay pending approval — proceed with Unsplash+Pexels only, or wait?') &&
      !existingQuestionTitles.has('Pixabay pending — ship with Unsplash+Pexels only, or wait?')) {
    await questionsManager.seedFromRecord({
      title: 'Pixabay pending — ship with Unsplash+Pexels only, or wait?',
      state: 'open',
      priority: 'normal',
      context:
        'The image search feature is ready to ship but Pixabay API approval is still pending (submitted 3 days ago). ' +
        'Unsplash and Pexels APIs are already approved and integrated. ' +
        'Should we ship now with two sources, or hold the release until Pixabay is approved?',
      recommendations: [
        {
          id: 'rec_A',
          label: 'Ship now with Unsplash + Pexels; add Pixabay when approved',
          rationale:
            'Users get the feature faster. Pixabay can be added as a non-breaking update later. Approval could take days or weeks.',
          isDefault: true,
        },
        {
          id: 'rec_B',
          label: 'Wait for Pixabay approval before shipping (max 5 more days)',
          rationale:
            'Pixabay has the largest free library. Shipping once with all three sources makes for a stronger launch.',
        },
      ],
      customAnswerPlaceholder: 'Other approach (e.g. ship with a placeholder for Pixabay)...',
    });
  }
}
