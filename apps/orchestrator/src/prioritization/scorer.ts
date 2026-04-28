/**
 * Composite priority scorer (0-100).
 *
 * Weights:
 *   urgency           25%
 *   blast_radius      20%
 *   user_visible      15%
 *   risk_if_delayed   15%
 *   domain_criticality 15%
 *   confidence        10%
 *   effort (inverse) -10%
 */

import type { ScoringDimensions, PriorityRationale, PriorityBucket, TaskScoringContext } from './types';
import { assignBucket } from './bucketer';

// Domains by criticality tier
const CRITICAL_DOMAINS = new Set(['security', 'data-backend', 'accessibility']);
const HIGH_DOMAINS = new Set(['integrity-check', 'backend-core', 'testing-qa', 'deployment-devops']);
const MEDIUM_DOMAINS = new Set([
  'conductor-architecture', 'framework-scaffold', 'seo', 'analytics',
  'seo-program', 'cast-bridge', 'dev-inspector',
]);
const LOW_DOMAINS = new Set(['content', 'marketing', 'martech', 'theming-branding', 'media-imagery', 'image-provider']);

// User-visible domains
const USER_VISIBLE_DOMAINS = new Set([
  'conductor-dashboard-features', 'content', 'seo', 'marketing', 'theming-branding', 'media-imagery',
]);

// Risk domains
const RISK_DOMAINS = new Set(['security', 'data-backend', 'integrity-check', 'accessibility']);
const RISK_HIGH_DOMAINS = new Set(['testing-qa', 'deployment-devops', 'backend-core']);

// Urgency title keywords
const URGENCY_KEYWORDS = /\b(blocker|critical|urgent|broken|crash|down|regression|hotfix|production|prod)\b/i;

function scoreDomainCriticality(domainSlug: string | null): number {
  if (!domainSlug) return 0.3;
  if (CRITICAL_DOMAINS.has(domainSlug)) return 1.0;
  if (HIGH_DOMAINS.has(domainSlug)) return 0.8;
  if (MEDIUM_DOMAINS.has(domainSlug)) return 0.6;
  if (LOW_DOMAINS.has(domainSlug)) return 0.4;
  return 0.3;
}

function scoreUrgency(ctx: TaskScoringContext): number {
  if (CRITICAL_DOMAINS.has(ctx.domainSlug ?? '')) return 1.0;
  if (URGENCY_KEYWORDS.test(ctx.title)) return 0.9;
  if (ctx.openBlockerCount > 0) return 0.8;
  if (HIGH_DOMAINS.has(ctx.domainSlug ?? '')) return 0.6;
  if ((ctx.notes?.length ?? 0) > 150) return 0.5;
  return 0.3;
}

function scoreBlastRadius(dependentCount: number): number {
  if (dependentCount >= 5) return 1.0;
  if (dependentCount >= 3) return 0.8;
  if (dependentCount === 2) return 0.6;
  if (dependentCount === 1) return 0.4;
  return 0.0;
}

function scoreUserVisible(ctx: TaskScoringContext): number {
  if (USER_VISIBLE_DOMAINS.has(ctx.domainSlug ?? '')) return 1.0;
  if (/\b(dashboard|ui|page|screen|display|modal|view|front.?end)\b/i.test(ctx.title)) return 0.8;
  if (MEDIUM_DOMAINS.has(ctx.domainSlug ?? '')) return 0.5;
  return 0.2;
}

function scoreRiskIfDelayed(domainSlug: string | null): number {
  if (!domainSlug) return 0.3;
  if (RISK_DOMAINS.has(domainSlug)) return 1.0;
  if (RISK_HIGH_DOMAINS.has(domainSlug)) return 0.8;
  return 0.3;
}

function scoreEffortInverse(declaredFiles: string[]): number {
  const effort = Math.min(declaredFiles.length / 10, 1.0);
  return 1.0 - effort;
}

function scoreConfidence(ctx: TaskScoringContext): number {
  let score = 0.0;
  if ((ctx.notes?.length ?? 0) > 50) score += 0.4;
  if (ctx.declaredFiles.length > 0) score += 0.4;
  if (ctx.title.length > 15) score += 0.2;
  return Math.min(score, 1.0);
}

function buildSummary(dims: ScoringDimensions, score: number, bucket: PriorityBucket): string {
  const top: string[] = [];
  if (dims.urgency >= 0.8) top.push('high urgency');
  if (dims.blastRadius >= 0.6) top.push('blocks others');
  if (dims.domainCriticality >= 0.8) top.push('critical domain');
  if (dims.riskIfDelayed >= 0.8) top.push('high risk if delayed');
  if (dims.userVisible >= 0.8) top.push('user-visible');
  if (top.length === 0) top.push('routine task');
  return `${bucket} (${score}/100): ${top.join(', ')}`;
}

export function scoreTask(ctx: TaskScoringContext): PriorityRationale {
  const dims: ScoringDimensions = {
    urgency: scoreUrgency(ctx),
    blastRadius: scoreBlastRadius(ctx.dependentCount),
    userVisible: scoreUserVisible(ctx),
    riskIfDelayed: scoreRiskIfDelayed(ctx.domainSlug),
    effortInverse: scoreEffortInverse(ctx.declaredFiles),
    confidence: scoreConfidence(ctx),
    domainCriticality: scoreDomainCriticality(ctx.domainSlug),
  };

  const raw =
    dims.urgency          * 25 +
    dims.blastRadius      * 20 +
    dims.userVisible      * 15 +
    dims.riskIfDelayed    * 15 +
    dims.domainCriticality * 15 +
    dims.confidence       * 10 +
    dims.effortInverse    * 10;

  const score = Math.round(Math.max(0, Math.min(100, raw)));
  const hardBlockerOverride = ctx.dependentCount >= 5;
  const bucket = assignBucket(score, ctx.dependentCount);

  return {
    dimensions: dims,
    score,
    bucket,
    summary: buildSummary(dims, score, bucket),
    hardBlockerOverride,
  };
}
