import { describe, expect, it } from "vitest";
import { parseTsPruneOutput, runTsPrune } from "../src/scanners/ts-prune.js";

describe("parseTsPruneOutput", () => {
  it("returns [] for empty stdout", () => {
    expect(parseTsPruneOutput("", "/tmp/pkg")).toEqual([]);
  });
  it("parses a single unused-export line as error severity", () => {
    const out = parseTsPruneOutput("src/foo.ts:12 - bar", "/tmp/pkg");
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("unused-export");
    expect(out[0]?.severity).toBe("error");
    expect(out[0]?.symbol).toBe("bar");
    expect(out[0]?.filePath).toBe("/tmp/pkg/src/foo.ts");
  });
  it("parses (used in module) suffix as warn severity", () => {
    const out = parseTsPruneOutput("src/foo.ts:12 - bar (used in module)", "/tmp/pkg");
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe("warn");
    expect(out[0]?.message).toContain("used only in its own module");
  });
  it("skips blank lines and (skip) markers", () => {
    const stdout = "\n(skip) something\nsrc/x.ts:1 - X\n";
    const out = parseTsPruneOutput(stdout, "/tmp/pkg");
    expect(out).toHaveLength(1);
    expect(out[0]?.symbol).toBe("X");
  });
  it("handles multiple lines", () => {
    const stdout = "src/a.ts:1 - A\nsrc/b.ts:2 - B\nsrc/c.ts:3 - C";
    expect(parseTsPruneOutput(stdout, "/tmp/pkg")).toHaveLength(3);
  });
  it("preserves absolute file paths if scanner already emitted them", () => {
    const out = parseTsPruneOutput("/abs/src/foo.ts:12 - bar", "/tmp/pkg");
    expect(out[0]?.filePath).toBe("/abs/src/foo.ts");
  });
  it("runTsPrune with stdoutOverride parses without spawning", async () => {
    const res = await runTsPrune("/tmp/pkg", { stdoutOverride: "src/a.ts:1 - foo" });
    expect(res.tooling).toBe("present");
    expect(res.findings).toHaveLength(1);
  });
  it("runTsPrune absent binary returns tooling=absent", async () => {
    const res = await runTsPrune("/tmp/pkg", { binaryOverride: "/no/such/ts-prune-xyz" });
    expect(res.tooling).toBe("absent");
  });
});
