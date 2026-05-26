import { describe, expect, it } from "vitest";
import { searchReuseCandidates, type RawPackage } from "../src/index.js";

const PKG = (over: Partial<RawPackage> & { name: string }): RawPackage => ({
  description: "",
  keywords: [],
  exports: [],
  ...over,
});

describe("searchReuseCandidates — additional coverage", () => {
  it("returns @caia/ui for 'card'", async () => {
    const out = await searchReuseCandidates("card", {
      inMemoryPackages: [
        PKG({ name: "@caia/ui", keywords: ["card"], exports: ["Card"] }),
        PKG({ name: "@chiefaia/logger", keywords: ["log"] }),
      ],
    });
    expect(out[0]?.packageName).toBe("@caia/ui");
  });

  it("returns @caia/ui for 'dialog'", async () => {
    const out = await searchReuseCandidates("dialog", {
      inMemoryPackages: [
        PKG({ name: "@caia/ui", keywords: ["dialog"], exports: ["Dialog"] }),
        PKG({ name: "@chiefaia/logger" }),
      ],
    });
    expect(out[0]?.packageName).toBe("@caia/ui");
  });

  it("returns @caia/ui for 'form'", async () => {
    const out = await searchReuseCandidates("form input field", {
      inMemoryPackages: [
        PKG({ name: "@caia/ui", keywords: ["form"], exports: ["FormField", "Input", "Label"] }),
        PKG({ name: "@chiefaia/events" }),
      ],
    });
    expect(out[0]?.packageName).toBe("@caia/ui");
  });

  it("descending order: scores monotonically decrease", async () => {
    const out = await searchReuseCandidates("button ui card form dialog input badge", {
      inMemoryPackages: [
        PKG({ name: "@caia/ui", keywords: ["button", "ui", "card", "form", "dialog", "input", "badge"] }),
        PKG({ name: "@caia/state-machine", keywords: ["state"] }),
        PKG({ name: "@chiefaia/events", keywords: ["events"] }),
      ],
    });
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.matchScore).toBeGreaterThanOrEqual(out[i]!.matchScore);
    }
  });

  it("matched terms appear in matchReasons", async () => {
    const out = await searchReuseCandidates("button", {
      inMemoryPackages: [PKG({ name: "@caia/ui", exports: ["Button"] })],
    });
    expect(out[0]?.matchReasons.join(" ")).toMatch(/button/i);
  });

  it("inMemoryPackages without keywords still ranks via name", async () => {
    const out = await searchReuseCandidates("logger", {
      inMemoryPackages: [PKG({ name: "@chiefaia/logger" })],
    });
    expect(out[0]?.packageName).toBe("@chiefaia/logger");
  });

  it("multi-token brief sums weights across matches", async () => {
    const out = await searchReuseCandidates("logger logger logger", {
      inMemoryPackages: [PKG({ name: "@chiefaia/logger", description: "logger logger logger" })],
    });
    expect(out.length).toBe(1);
  });

  it("returns no duplicates", async () => {
    const out = await searchReuseCandidates("ui", {
      inMemoryPackages: [
        PKG({ name: "@caia/ui", keywords: ["ui"] }),
        PKG({ name: "@chiefaia/events", keywords: ["bus"] }),
      ],
    });
    const names = out.map((c) => c.packageName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("excludes packages with no matches even when others match", async () => {
    const out = await searchReuseCandidates("button", {
      inMemoryPackages: [
        PKG({ name: "@caia/ui", exports: ["Button"] }),
        PKG({ name: "@chiefaia/events", keywords: ["bus"] }),
      ],
    });
    expect(out.map((c) => c.packageName)).toEqual(["@caia/ui"]);
  });

  it("returns at most topN even with many matches", async () => {
    const many: RawPackage[] = Array.from({ length: 20 }, (_, i) => PKG({ name: `@caia/p${i}`, keywords: ["button"] }));
    const out = await searchReuseCandidates("button", { inMemoryPackages: many, topN: 5 });
    expect(out.length).toBe(5);
  });
});
