import { describe, expect, it } from "vitest";
import {
  withReuseCandidates,
  enrichBriefWithReuseSearch,
  hasReuseCandidatesBlock,
  REUSE_CANDIDATES_HEADER,
  type RankedCandidate,
} from "../src/index.js";

const C = (over: Partial<RankedCandidate>): RankedCandidate => ({
  packageName: "@caia/ui",
  description: "UI primitives",
  mainExports: ["Button"],
  matchScore: 1,
  matchReasons: ["matched export: button"],
  ...over,
});

describe("withReuseCandidates", () => {
  it("prepends the header + candidate list", () => {
    const out = withReuseCandidates("Build a button.", [C({})]);
    expect(out.startsWith(REUSE_CANDIDATES_HEADER)).toBe(true);
    expect(out).toContain("@caia/ui");
    expect(out).toContain("Build a button.");
  });

  it("emits 'no candidates' note when list is empty", () => {
    const out = withReuseCandidates("Build something.", []);
    expect(out.startsWith(REUSE_CANDIDATES_HEADER)).toBe(true);
    expect(out).toContain("No reuse candidates");
    expect(out).toContain("Build something.");
  });

  it("is idempotent — does not double-inject", () => {
    const once = withReuseCandidates("brief", [C({})]);
    const twice = withReuseCandidates(once, [C({})]);
    expect(twice).toBe(once);
  });

  it("includes match reasons in output", () => {
    const out = withReuseCandidates("brief", [C({ matchReasons: ["matched export: foo"] })]);
    expect(out).toContain("matched export: foo");
  });

  it("orders candidates as given", () => {
    const out = withReuseCandidates("brief", [
      C({ packageName: "@caia/a" }),
      C({ packageName: "@caia/b" }),
      C({ packageName: "@caia/c" }),
    ]);
    const ai = out.indexOf("@caia/a");
    const bi = out.indexOf("@caia/b");
    const ci = out.indexOf("@caia/c");
    expect(ai).toBeLessThan(bi);
    expect(bi).toBeLessThan(ci);
  });

  it("preserves the brief text verbatim at the end", () => {
    const brief = "Special chars: <>&\"' — preserved.";
    expect(withReuseCandidates(brief, [C({})])).toContain(brief);
  });
});

describe("hasReuseCandidatesBlock", () => {
  it("detects an injected brief", () => {
    expect(hasReuseCandidatesBlock(withReuseCandidates("x", [C({})]))).toBe(true);
  });
  it("returns false for a bare brief", () => {
    expect(hasReuseCandidatesBlock("plain brief")).toBe(false);
  });
});

describe("enrichBriefWithReuseSearch", () => {
  it("returns the candidates + enriched brief together", async () => {
    const { enrichedBrief, candidates } = await enrichBriefWithReuseSearch("button", {
      inMemoryPackages: [
        { name: "@caia/ui", description: "UI", keywords: ["button"], exports: ["Button"] },
      ],
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(enrichedBrief.startsWith(REUSE_CANDIDATES_HEADER)).toBe(true);
    expect(enrichedBrief).toContain("button");
  });

  it("gracefully handles empty results", async () => {
    const { enrichedBrief, candidates } = await enrichBriefWithReuseSearch("nonsense xyz123 token", {
      inMemoryPackages: [{ name: "@caia/ui", description: "UI", keywords: ["button"], exports: ["Button"] }],
    });
    expect(candidates).toEqual([]);
    expect(enrichedBrief).toContain("No reuse candidates");
  });
});
