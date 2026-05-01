import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

interface Task {
  status?: string;
  completedAt?: string;
  createdAt?: string;
}

interface Story {
  status?: string;
  phase?: string;
  createdAt?: string;
  completedAt?: string;
}

interface SpendData {
  todayUsd?: number;
  weekUsd?: number;
}

export interface ProjectionData {
  velocity: {
    tasksCompletedLast7d: number;
    tasksPerDay: number;
    tasksRemaining: number;
    estimatedDaysToComplete: number | null;
  };
  stories: {
    total: number;
    done: number;
    inProgress: number;
    ready: number;
    blocked: number;
    avgCycleTimeDays: number | null;
    estimatedCompletionDate: string | null;
  };
  cost: {
    dailyAvgUsd: number;
    projectedMonthlyUsd: number;
    projectedWeeklyUsd: number;
  };
  generatedAt: string;
}

async function safeFetch<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { next: { revalidate: 0 } });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export async function GET() {
  const [tasks, stories, spend] = await Promise.all([
    safeFetch<Task[]>(`${CONDUCTOR_URL}/tasks`, []),
    safeFetch<Story[]>(`${CONDUCTOR_URL}/stories`, []),
    safeFetch<SpendData>(`${CONDUCTOR_URL}/spend/today`, {}),
  ]);

  const cutoff7d = daysAgo(7).getTime();

  // Velocity
  const completedLast7d = tasks.filter((t) => {
    if (t.status !== 'done' && t.status !== 'completed') return false;
    if (!t.completedAt) return false;
    return new Date(t.completedAt).getTime() >= cutoff7d;
  });

  const tasksPerDay = completedLast7d.length / 7;
  const tasksRemaining = tasks.filter(
    (t) => t.status !== 'done' && t.status !== 'completed' && t.status !== 'cancelled',
  ).length;
  const estimatedDaysToComplete = tasksPerDay > 0 ? Math.ceil(tasksRemaining / tasksPerDay) : null;

  // Stories
  const storyDone = stories.filter(
    (s) => s.status === 'done' || s.status === 'completed' || s.phase === 'done',
  ).length;
  const storyInProgress = stories.filter(
    (s) =>
      s.status === 'in-progress' ||
      s.status === 'in_progress' ||
      s.phase === 'coding' ||
      s.phase === 'review',
  ).length;
  const storyBlocked = stories.filter((s) => s.status === 'blocked').length;
  const storyReady = stories.filter(
    (s) =>
      s.status === 'ready' ||
      s.status === 'backlog' ||
      s.status === 'open' ||
      s.phase === 'ready',
  ).length;

  // Avg cycle time from completed stories
  const cycleTimeDays: number[] = [];
  for (const s of stories) {
    if ((s.status === 'done' || s.status === 'completed') && s.createdAt && s.completedAt) {
      const diff =
        (new Date(s.completedAt).getTime() - new Date(s.createdAt).getTime()) / 86_400_000;
      if (diff > 0 && diff < 365) cycleTimeDays.push(diff);
    }
  }
  const avgCycleTimeDays =
    cycleTimeDays.length > 0
      ? cycleTimeDays.reduce((a, b) => a + b, 0) / cycleTimeDays.length
      : null;

  const storiesRemaining = storyReady + storyInProgress;
  let estimatedCompletionDate: string | null = null;
  if (avgCycleTimeDays !== null && storiesRemaining > 0) {
    const d = new Date();
    d.setDate(d.getDate() + Math.ceil(storiesRemaining * avgCycleTimeDays));
    estimatedCompletionDate = d.toISOString().slice(0, 10);
  }

  // Cost projections
  const dailyAvgUsd = spend.todayUsd ?? (spend.weekUsd ? spend.weekUsd / 7 : 0);
  const projectedWeeklyUsd = dailyAvgUsd * 7;
  const projectedMonthlyUsd = dailyAvgUsd * 30;

  const result: ProjectionData = {
    velocity: {
      tasksCompletedLast7d: completedLast7d.length,
      tasksPerDay,
      tasksRemaining,
      estimatedDaysToComplete,
    },
    stories: {
      total: stories.length,
      done: storyDone,
      inProgress: storyInProgress,
      ready: storyReady,
      blocked: storyBlocked,
      avgCycleTimeDays,
      estimatedCompletionDate,
    },
    cost: {
      dailyAvgUsd,
      projectedMonthlyUsd,
      projectedWeeklyUsd,
    },
    generatedAt: new Date().toISOString(),
  };

  return NextResponse.json(result);
}
