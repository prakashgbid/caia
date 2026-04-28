import type { ContentType } from './types';

export const DAILY_TARGETS: Record<ContentType, number> = {
  'forum-thread':     7,
  'reply':            44,
  'hand-review':      1.3,
  'spin-analysis':    1.3,
  'poll':             0.4,
  'tip':              3.3,
  'meetup':           0.7,
  'venue-review':     0.6,
  'tournament-recap': 0.4,
  'welcome-intro':    0.2,
  'reaction':         0.9,
  'article':          0.6,
  'research-paper':   0.2,
  'interview':        0.1,
  'editorial-pick':   0.1,
  'quarterly-report': 0.02,
} as const;

/**
 * Compute how many items to generate on a given calendar day index (0-89).
 * Uses a Poisson-like distribution: base + weekend bump + weekday dip.
 */
export function computeDayCount(type: ContentType, dayIndex: number, rng: () => number): number {
  const base = DAILY_TARGETS[type];
  // Day 0 = April 20, 2026 (Sunday). dayOfWeek 0=Mon,6=Sun
  const dayOfWeek = (dayIndex + 6) % 7; // shift so 0=Mon
  const isWeekend = dayOfWeek >= 5;
  const multiplier = isWeekend ? 1.3 : 1.0;
  const adjusted = base * multiplier;

  // For fractional targets, use stochastic rounding
  const floor = Math.floor(adjusted);
  const frac = adjusted - floor;
  return floor + (rng() < frac ? 1 : 0);
}

/** Total 90-day targets per type */
export const NINETY_DAY_TARGETS: Record<ContentType, number> = {
  'forum-thread':     700,
  'reply':            4000,
  'hand-review':      120,
  'spin-analysis':    120,
  'poll':             35,
  'tip':              300,
  'meetup':           60,
  'venue-review':     50,
  'tournament-recap': 40,
  'welcome-intro':    20,
  'reaction':         80,
  'article':          50,
  'research-paper':   15,
  'interview':        8,
  'editorial-pick':   12,
  'quarterly-report': 2,
} as const;
