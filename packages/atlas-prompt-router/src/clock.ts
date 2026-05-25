/**
 * Clock port — the only entrypoint for "what time is it" inside the
 * router. The system implementation reads the wall clock; the frozen
 * implementation returns a fixed instant. Tests always use the frozen
 * clock so version timestamps + enqueue timestamps are deterministic.
 */

export type Clock = () => string;

export function systemClock(): Clock {
  return (): string => new Date().toISOString();
}

export function frozenClockFrom(iso: string): Clock {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`frozenClockFrom: cannot parse '${iso}' as ISO-8601`);
  }
  const normalised = parsed.toISOString();
  return (): string => normalised;
}

export function steppingClockFrom(iso: string, stepMs: number): Clock {
  const start = new Date(iso);
  if (Number.isNaN(start.getTime())) {
    throw new TypeError(`steppingClockFrom: cannot parse '${iso}' as ISO-8601`);
  }
  if (!Number.isFinite(stepMs) || stepMs < 0) {
    throw new TypeError(`steppingClockFrom: stepMs must be a non-negative finite number, got ${stepMs}`);
  }
  let calls = 0;
  return (): string => {
    const t = new Date(start.getTime() + calls * stepMs);
    calls += 1;
    return t.toISOString();
  };
}
