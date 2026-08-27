/**
 * Client-side token ledger for the demo funnel.
 *
 * Anonymous session starts with STARTING_TOKENS. Each stage consumes a
 * fixed amount (see STAGE_COSTS). When balance hits 0, the wizard shows
 * a login gate that credits LOGIN_REWARD on success.
 *
 * Storage: window.localStorage under 'caia_session'. No backend ledger
 * yet — a per-tenant DB-backed balance lands post-payment per operator
 * direction. Server-side calls DON'T check tokens today; the UI simply
 * gates progression on the local balance.
 */

export const STARTING_TOKENS = 50;
export const LOGIN_REWARD = 100;

export const STAGE_COSTS: Record<string, number> = {
  onboarding: 0,       // free, first-touch
  'grand-idea': 3,     // trivial capture
  interview: 8,        // several AI calls under the hood
  architecture: 10,    // IA generator
  proposal: 15,        // biggest freeform generator
  landing: 14,         // landing page generator
  // Total to end of proposal + landing = 50 → exhaust exactly here
  login: 0,            // credits +LOGIN_REWARD
  build: 25,           // sandpack + N screen generations
  subscribe: 0,        // gate, no cost
};

const KEY = 'caia_session';

export interface Session {
  tokens: number;
  loggedIn: boolean;
  displayName?: string;
  email?: string;
  history: Array<{ stage: string; cost: number; at: number }>;
}

const emptySession: Session = { tokens: STARTING_TOKENS, loggedIn: false, history: [] };

export function readSession(): Session {
  if (typeof window === 'undefined') return emptySession;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptySession;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return {
      tokens: typeof parsed.tokens === 'number' ? parsed.tokens : STARTING_TOKENS,
      loggedIn: !!parsed.loggedIn,
      displayName: parsed.displayName,
      email: parsed.email,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return emptySession;
  }
}

export function writeSession(s: Session): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent('caia:session-change', { detail: s }));
  } catch {
    /* noop */
  }
}

export function spendTokens(stage: string): Session {
  const cost = STAGE_COSTS[stage] ?? 0;
  const cur = readSession();
  if (cost === 0) return cur;
  const already = cur.history.some((h) => h.stage === stage);
  if (already) return cur;   // idempotent — same stage never charged twice
  const next: Session = {
    ...cur,
    tokens: Math.max(0, cur.tokens - cost),
    history: [...cur.history, { stage, cost, at: Date.now() }],
  };
  writeSession(next);
  return next;
}

export function grantLoginReward(displayName: string, email: string): Session {
  const cur = readSession();
  const next: Session = {
    ...cur,
    tokens: cur.tokens + LOGIN_REWARD,
    loggedIn: true,
    displayName,
    email,
    history: [...cur.history, { stage: 'login-reward', cost: -LOGIN_REWARD, at: Date.now() }],
  };
  writeSession(next);
  return next;
}

export function resetSession(): Session {
  writeSession(emptySession);
  return emptySession;
}
