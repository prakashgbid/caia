export function isoNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function parseIso(ts: string): Date {
  // Accept the same compact ISO format we emit (no millis).
  // Date.parse handles it fine; we keep this thin for symmetry with
  // the Python helper.
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`invalid ISO timestamp: ${ts}`);
  }
  return d;
}
