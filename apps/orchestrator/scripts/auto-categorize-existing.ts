/**
 * Auto-categorize existing entities by applying keyword-based domain matching.
 * Scans every requirement, blocker, question, ADR, feature, suggestion, and timeline entry.
 * Writes entity_domains rows with auto_tagged=true.
 * Run: npx ts-node scripts/auto-categorize-existing.ts
 */
import * as path from 'path';
import * as os from 'os';
import { getDb, runMigrations } from '../src/db/connection';
import {
  requirements, blockers, questions, adrs, businessFeatures,
  proactiveSuggestions, timelineEvents, entityDomains, domains,
} from '../src/db/schema';

const DB_URL = process.env['CONDUCTOR_DB_URL'] ?? path.join(os.homedir(), '.conductor', 'db.sqlite');

// Keyword rules: [domainSlug, ...keywords]
const DOMAIN_RULES: Array<[string, string[]]> = [
  ['accessibility', ['accessibility', 'a11y', 'wcag', 'axe', 'aria', 'screen reader', 'screen-reader', 'keyboard nav', 'contrast', 'focus trap', 'alt text']],
  ['seo', ['seo', 'sitemap', 'robots.txt', 'meta description', 'canonical', 'keyword', 'serp', 'search ranking', 'structured data', 'schema.org', 'og:', 'open graph', 'search engine']],
  ['analytics', ['ga4', 'gtag', 'google analytics', 'cloudflare analytics', 'cwa', 'event tracking', 'pageview', 'conversion', 'funnel', 'analytics']],
  ['martech', ['ga4', 'attribution', 'email marketing', 'campaign', 'drip', 'mailchimp', 'klaviyo', 'sendgrid', 'marketing automation', 'lead', 'crm']],
  ['gameplay', ['poker', 'roulette', 'play page', '/play', 'game engine', 'betting', 'hand history', 'pot odds', 'bankroll', 'dealer', 'shuffle', 'card']],
  ['accessibility', ['axe-core', 'tab order', 'landmark', 'role=', 'aria-label', 'aria-describedby']],
  ['deployment-devops', ['cloudflare pages', 'wrangler', 'ci/cd', 'github actions', 'deploy', 'pipeline', 'dockerfile', 'container', 'build', 'release', 'workflow yaml']],
  ['testing-qa', ['playwright', 'jest', 'vitest', 'cypress', 'e2e', 'unit test', 'integration test', 'test coverage', 'axe-core test', 'integrity gate']],
  ['security', ['secret', 'token', 'api key', 'env var', '.env', 'auth', 'jwt', 'oauth', 'cors', 'csrf', 'sql injection', 'xss', 'sanitiz', 'permission', 'rbac', 'hook enforcement']],
  ['data-backend', ['supabase', 'postgres', 'postgresql', 'database', 'schema migration', 'rls', 'row level security', 'query', 'index', 'sqlite', 'drizzle']],
  ['content', ['editorial', 'blog post', 'article', 'publication', 'cms', 'authoring', 'content type', 'rich text', 'mdx', 'markdown']],
  ['media-imagery', ['image', 'photo', 'r2 bucket', 'og image', 'cloudflare r2', 'media upload', 'resize', 'webp', 'jpeg', 'png', 'no-minors', 'safe-for-work']],
  ['theming-branding', ['brand', 'design token', 'color palette', 'typography', 'logo', 'theming', 'css variable', 'dark mode', 'visual design', 'pokerzeno brand']],
  ['marketing', ['campaign', 'landing page', 'cta', 'conversion rate', 'brand positioning', 'ad copy', 'social media', 'press release']],
  ['framework-scaffold', ['monorepo', 'site-template', 'scaffold', 'boilerplate', 'adr', 'architecture decision', 'turbo', 'nx', 'workspace']],
  ['conductor-architecture', ['conductor', 'mcp server', 'hono', 'drizzle', 'websocket', 'api route', 'pump engine', 'requirements manager', 'blocker', 'timeline event']],
  ['conductor-dashboard-features', ['dashboard', 'nav', 'sidebar', 'kanban', 'domain chip', 'filter bar', 'timeline feed', 'metrics widget']],
  ['image-provider', ['image-provider', 'image provider plugin']],
  ['cast-bridge', ['cast-bridge', 'cast bridge plugin']],
  ['dev-inspector', ['dev-inspector', 'dev inspector plugin']],
  ['backend-core', ['backend-core', 'backend core plugin']],
  ['content-engine', ['content-engine', 'content engine plugin']],
  ['integrity-check', ['integrity-check', 'integrity check plugin', 'integrity gate']],
  ['seo-program', ['seo-program', 'seo program plugin']],
];

function textOf(obj: Record<string, unknown>): string {
  return [obj['title'], obj['description'], obj['context'], obj['summary'], obj['decision'], obj['rationale'], obj['kind']]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchDomains(text: string): string[] {
  const matched = new Set<string>();
  for (const [slug, keywords] of DOMAIN_RULES) {
    if (keywords.some(kw => text.includes(kw))) matched.add(slug);
  }
  return Array.from(matched);
}

async function run() {
  console.log('Auto-categorize: connecting to', DB_URL);
  runMigrations(DB_URL);
  const db = getDb(DB_URL);

  type EntityRow = Record<string, unknown> & { id: string };
  const entityGroups: Array<{ type: string; rows: EntityRow[] }> = [
    { type: 'requirement', rows: db.select().from(requirements).all() as EntityRow[] },
    { type: 'blocker', rows: db.select().from(blockers).all() as EntityRow[] },
    { type: 'question', rows: db.select().from(questions).all() as EntityRow[] },
    { type: 'adr', rows: db.select().from(adrs).all() as EntityRow[] },
    { type: 'feature', rows: db.select().from(businessFeatures).all() as EntityRow[] },
    { type: 'suggestion', rows: db.select().from(proactiveSuggestions).all() as EntityRow[] },
    { type: 'timeline', rows: db.select().from(timelineEvents).all() as EntityRow[] },
  ];

  const now = new Date().toISOString();
  let totalTagged = 0;
  let totalSkipped = 0;
  const auditEntries: string[] = [];

  for (const { type, rows } of entityGroups) {
    let typeTagged = 0;
    for (const row of rows) {
      const text = textOf(row);
      const matched = matchDomains(text);
      if (!matched.length) continue;

      for (const domainSlug of matched) {
        try {
          db.insert(entityDomains).values({
            entityType: type,
            entityId: row.id,
            domainSlug,
            autoTagged: true,
            createdAt: now,
          }).run();
          typeTagged++;
          totalTagged++;
          auditEntries.push(`[${type}] ${row.id} → ${domainSlug}`);
        } catch {
          totalSkipped++;
        }
      }
    }
    console.log(`  ${type}: ${rows.length} entities, ${typeTagged} tags added`);
  }

  console.log(`\nDone. ${totalTagged} tags added, ${totalSkipped} skipped (already existed).`);

  if (auditEntries.length) {
    console.log('\nAudit log (first 50):');
    auditEntries.slice(0, 50).forEach(e => console.log(' ', e));
    if (auditEntries.length > 50) console.log(`  ... and ${auditEntries.length - 50} more`);
  }

  // Integrity check: flag any seeded domain with zero entities
  const allDomainRows = db.select().from(entityDomains).all();
  const domainsWithEntities = new Set(allDomainRows.map(r => r.domainSlug));
  const allDomainSlugs = db.select({ slug: domains.slug }).from(domains).all();
  const empty = allDomainSlugs.filter(d => !domainsWithEntities.has(d.slug)).map(d => d.slug);
  if (empty.length) {
    console.log('\n⚠ Domains with zero entities (review needed):', empty.join(', '));
  } else {
    console.log('\n✓ All domains have at least one entity tag.');
  }
}

run().catch(err => {
  console.error('Auto-categorize failed:', err);
  process.exit(1);
});
