import { NextResponse } from 'next/server';

const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';

const EMPTY: PlatformStats = {
  totalPrompts: 0,
  activeTasks: 0,
  blockedTasks: 0,
  completedToday: 0,
  avgTaskDurationMs: 0,
  queueDepth: 0,
  lastUpdated: 0,
};

interface PlatformStats {
  totalPrompts: number;
  activeTasks: number;
  blockedTasks: number;
  completedToday: number;
  avgTaskDurationMs: number;
  queueDepth: number;
  lastUpdated: number;
}

export async function GET() {
  try {
    const res = await fetch(`${CONDUCTOR_URL}/platform-stats`, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json(EMPTY, { status: 200 });
    const data = await res.json() as PlatformStats;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(EMPTY, { status: 200 });
  }
}
