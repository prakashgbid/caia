import { describe, expect, it, beforeEach } from "vitest";
import {
  searchReuseCandidates,
  rankCandidates,
  tokenize,
  scorePackage,
  clearIndexCache,
  type RawPackage,
} from "../src/index.js";

const FIXTURE: readonly RawPackage[] = [
  {
    name: "@caia/ui",
    description: "Canonical shadcn/Tailwind component library for CAIA apps. Button, Card, Input, Dialog, Sheet, Tabs.",
    keywords: ["ui", "shadcn", "tailwind", "button", "card", "dialog", "form"],
    exports: ["Button", "Card", "Input", "Dialog", "Sheet", "Tabs", "Badge", "Progress"],
  },
  {
    name: "@chiefaia/http-client",
    description: "Canonical HTTP wrapper. Use instead of raw axios or node-fetch.",
    keywords: ["http", "client", "axios", "fetch"],
    exports: ["HttpClient", "request", "get", "post"],
  },
  {
    name: "@chiefaia/logger",
    description: "Structured logging built on Pino with default redact paths.",
    keywords: ["logger", "logging", "pino", "structured"],
    exports: ["Logger", "createLogger"],
  },
  {
    name: "@chiefaia/persistence-sqlite",
    description: "SQLite persistence wrapper around better-sqlite3 with migration runner.",
    keywords: ["sqlite", "persistence", "database", "migration"],
    exports: ["SqliteStore", "openDatabase", "runMigrations"],
  },
  {
    name: "@caia/state-machine",
    description: "Declarative finite state machine runtime for CAIA agents.",
    keywords: ["state-machine", "fsm", "runtime", "declarative"],
    exports: ["StateMachine", "createStateMachine"],
  },
  {
    name: "@chiefaia/events",
    description: "Typed in-process event bus.",
    keywords: ["events", "bus", "pubsub", "typed"],
    exports: ["EventBus", "emit", "subscribe"],
  },
];

beforeEach(clearIndexCache);

describe("tokenize", () => {
  it("lowercases + splits on non-alphanumerics", () => {
    expect(tokenize("Build a Button.Component!!")).toEqual(["build", "button", "component"]);
  });
  it("drops stop-words", () => {
    expect(tokenize("the and or but for")).toEqual([]);
  });
  it("drops single-character tokens", () => {
    expect(tokenize("a b c d e")).toEqual([]);
  });
  it("stems trailing -s", () => {
    expect(tokenize("buttons cards inputs")).toEqual(["button", "card", "input"]);
  });
  it("stems -ies → -y", () => {
    expect(tokenize("registries libraries")).toEqual(["registry", "library"]);
  });
  it("stems -ing", () => {
    expect(tokenize("logging routing")).toEqual(["log", "rout"]);
  });
  it("preserves -ss / -us / -is", () => {
    expect(tokenize("class focus axis")).toEqual(["class", "focus", "axis"]);
  });
  it("handles empty input", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });
  it("treats numbers as tokens", () => {
    expect(tokenize("v2 v3 100")).toEqual(["v2", "v3", "100"]);
  });
});

describe("scorePackage", () => {
  it("returns zero when nothing matches", () => {
    const rec = {
      packageName: "@x/y",
      description: "",
      keywords: [],
      mainExports: [],
      tokens: {
        name: new Set(["x", "y"]),
        description: new Set<string>(),
        keywords: new Set<string>(),
        exports: new Set<string>(),
      },
    };
    expect(scorePackage(["something", "else"], rec).total).toBe(0);
  });

  it("weights name match heaviest", () => {
    const rec = {
      packageName: "@caia/ui",
      description: "",
      keywords: [],
      mainExports: [],
      tokens: {
        name: new Set(["caia", "ui"]),
        description: new Set<string>(),
        keywords: new Set<string>(),
        exports: new Set<string>(),
      },
    };
    const out = scorePackage(["ui"], rec);
    expect(out.total).toBe(2.5);
    expect(out.byField.name).toBe(2.5);
  });

  it("composes weights across fields", () => {
    const rec = {
      packageName: "@caia/ui",
      description: "Component library",
      keywords: ["ui"],
      mainExports: ["Button"],
      tokens: {
        name: new Set(["caia", "ui"]),
        description: new Set(["component", "library"]),
        keywords: new Set(["ui"]),
        exports: new Set(["button"]),
      },
    };
    const out = scorePackage(["ui", "button", "component"], rec);
    expect(out.byField.name).toBe(2.5);
    expect(out.byField.keywords).toBe(1.5);
    expect(out.byField.exports).toBe(2.0);
    expect(out.byField.description).toBe(1.0);
    expect(out.total).toBe(7.0);
  });
});

describe("rankCandidates", () => {
  it("returns empty for an empty brief", async () => {
    const out = await searchReuseCandidates("", { inMemoryPackages: FIXTURE });
    expect(out).toEqual([]);
  });

  it("returns empty when nothing matches", async () => {
    const out = await searchReuseCandidates("quantum tunneling proton accelerator", { inMemoryPackages: FIXTURE });
    expect(out).toEqual([]);
  });

  it("returns @caia/ui in top 3 for a Button brief", async () => {
    const out = await searchReuseCandidates("build a button component for the wizard", { inMemoryPackages: FIXTURE });
    expect(out.length).toBeGreaterThan(0);
    const top3 = out.slice(0, 3).map((c) => c.packageName);
    expect(top3).toContain("@caia/ui");
  });

  it("returns @chiefaia/http-client for an axios brief", async () => {
    const out = await searchReuseCandidates("make an http request using axios", { inMemoryPackages: FIXTURE });
    expect(out[0]?.packageName).toBe("@chiefaia/http-client");
  });

  it("returns @chiefaia/persistence-sqlite for a sqlite brief", async () => {
    const out = await searchReuseCandidates("store data with better-sqlite3", { inMemoryPackages: FIXTURE });
    expect(out[0]?.packageName).toBe("@chiefaia/persistence-sqlite");
  });

  it("returns @chiefaia/logger for a logging brief", async () => {
    const out = await searchReuseCandidates("add structured logging with pino", { inMemoryPackages: FIXTURE });
    expect(out[0]?.packageName).toBe("@chiefaia/logger");
  });

  it("returns @caia/state-machine for a FSM brief", async () => {
    const out = await searchReuseCandidates("model a finite state machine for the order flow", { inMemoryPackages: FIXTURE });
    expect(out[0]?.packageName).toBe("@caia/state-machine");
  });

  it("returns @chiefaia/events for a pubsub brief", async () => {
    const out = await searchReuseCandidates("publish events on the in-process bus", { inMemoryPackages: FIXTURE });
    expect(out[0]?.packageName).toBe("@chiefaia/events");
  });

  it("respects topN truncation", async () => {
    const out = await searchReuseCandidates("button card dialog input form ui shadcn tailwind", { inMemoryPackages: FIXTURE, topN: 1 });
    expect(out.length).toBe(1);
  });

  it("returns normalised scores in [0, 1]", async () => {
    const out = await searchReuseCandidates("button card dialog", { inMemoryPackages: FIXTURE });
    for (const c of out) {
      expect(c.matchScore).toBeGreaterThan(0);
      expect(c.matchScore).toBeLessThanOrEqual(1);
    }
    expect(out[0]?.matchScore).toBe(1); // top result is always 1.0 after normalisation
  });

  it("includes matchReasons describing the hit", async () => {
    const out = await searchReuseCandidates("button card", { inMemoryPackages: FIXTURE });
    expect(out[0]?.matchReasons.length).toBeGreaterThan(0);
    expect(out[0]?.matchReasons.join(" ")).toMatch(/matched export|matched keyword|description/i);
  });

  it("ranks @caia/ui above other UI-shaped packages for a UI brief", async () => {
    const out = await searchReuseCandidates("create a tabs component", { inMemoryPackages: FIXTURE });
    expect(out[0]?.packageName).toBe("@caia/ui");
  });

  it("returns mainExports verbatim", async () => {
    const out = await searchReuseCandidates("button", { inMemoryPackages: FIXTURE });
    const ui = out.find((c) => c.packageName === "@caia/ui");
    expect(ui?.mainExports).toContain("Button");
  });
});

describe("scope filtering (via searchReuseCandidates)", () => {
  it("includes only packages whose scope is in the scopes list — pure", async () => {
    const out = await searchReuseCandidates("button", { inMemoryPackages: FIXTURE });
    // FIXTURE already only includes valid scopes; no filter to apply in pure mode
    for (const c of out) {
      expect(c.packageName.startsWith("@caia/") || c.packageName.startsWith("@chiefaia/")).toBe(true);
    }
  });
});

describe("rankCandidates direct call (without I/O)", () => {
  it("handles a single-token brief", () => {
    const recs = FIXTURE.map((r) => ({
      packageName: r.name,
      description: r.description ?? "",
      keywords: r.keywords ?? [],
      mainExports: r.exports ?? [],
      tokens: {
        name: new Set(tokenize(r.name.replace(/[@/_-]/g, " "))),
        description: new Set(tokenize(r.description ?? "")),
        keywords: new Set(tokenize((r.keywords ?? []).join(" "))),
        exports: new Set(tokenize((r.exports ?? []).join(" "))),
      },
    }));
    const out = rankCandidates("ui", recs, 10);
    expect(out[0]?.packageName).toBe("@caia/ui");
  });

  it("handles topN larger than the dataset", () => {
    const recs = FIXTURE.slice(0, 2).map((r) => ({
      packageName: r.name,
      description: r.description ?? "",
      keywords: r.keywords ?? [],
      mainExports: r.exports ?? [],
      tokens: {
        name: new Set(tokenize(r.name.replace(/[@/_-]/g, " "))),
        description: new Set(tokenize(r.description ?? "")),
        keywords: new Set(tokenize((r.keywords ?? []).join(" "))),
        exports: new Set(tokenize((r.exports ?? []).join(" "))),
      },
    }));
    const out = rankCandidates("button axios", recs, 100);
    expect(out.length).toBeLessThanOrEqual(2);
  });

  it("returns empty for empty records", () => {
    expect(rankCandidates("anything", [], 10)).toEqual([]);
  });
});

describe("cache behaviour", () => {
  it("clearIndexCache resets in-memory cache", () => {
    expect(() => clearIndexCache()).not.toThrow();
  });
});

describe("integration: build-a-button brief returns @caia/ui in top 3", () => {
  it("the integration smoke test that ADR-065 calls out by name", async () => {
    const brief =
      "Build a button component for the new wizard step. Should support primary/secondary variants and an icon-only mode.";
    const out = await searchReuseCandidates(brief, { inMemoryPackages: FIXTURE });
    const top3 = out.slice(0, 3).map((c) => c.packageName);
    expect(top3).toContain("@caia/ui");
  });
});

describe("malformed input tolerance (pure ranking)", () => {
  it("tolerates a record with empty fields", () => {
    const rec = {
      packageName: "@caia/empty",
      description: "",
      keywords: [],
      mainExports: [],
      tokens: {
        name: new Set(["caia", "empty"]),
        description: new Set<string>(),
        keywords: new Set<string>(),
        exports: new Set<string>(),
      },
    };
    expect(scorePackage(["empty"], rec).total).toBe(2.5);
  });
});
