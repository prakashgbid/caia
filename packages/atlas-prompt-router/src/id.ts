/**
 * ID-generation port — yields the next ticket-version id.
 *
 * Two implementations ship:
 *   - `counterIdGen(prefix)`  — deterministic, monotonically increasing
 *      `<prefix>_000001`, `<prefix>_000002`, ... Tests use this.
 *   - `randomIdGen(prefix, rng?)` — base32 random suffix; production
 *      uses this with `crypto.randomUUID()` as the rng source.
 */

export type IdGen = () => string;

export function counterIdGen(prefix: string): IdGen {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new TypeError(`counterIdGen: prefix must be a non-empty string`);
  }
  let n = 0;
  return (): string => {
    n += 1;
    const padded = String(n).padStart(6, '0');
    return `${prefix}_${padded}`;
  };
}

export function randomIdGen(prefix: string, rng: () => number = Math.random): IdGen {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new TypeError(`randomIdGen: prefix must be a non-empty string`);
  }
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  return (): string => {
    let out = '';
    for (let i = 0; i < 10; i++) {
      const idx = Math.floor(rng() * alphabet.length);
      out += alphabet[idx] ?? '0';
    }
    return `${prefix}_${out}`;
  };
}
