import { describe, expect, it, vi } from "vitest";
import {
  assertReuseSearchPresent,
  hasSelectedReusePackage,
  ReuseSearchGateError,
  submitPlanWithReuseGate,
  type PlanWithReuse,
  type ReuseSearchResult,
} from "../src/index.js";

function mkPlan(over: Partial<PlanWithReuse> = {}): PlanWithReuse {
  return {
    planMarkdown: "## Plan\n\nDo a thing.",
    planType: "implementation",
    callerAgentId: "test-agent",
    submittedBy: "operator",
    reuseSearchResults: [
      {
        packageName: "@caia/ui",
        considered: true,
        decision: "selected",
        reason: "Already exports the Button primitive we need",
      },
    ],
    ...over,
  };
}

describe("assertReuseSearchPresent — happy paths", () => {
  it("passes for implementation plan with one selected package", () => {
    expect(() => assertReuseSearchPresent(mkPlan())).not.toThrow();
  });

  it("passes for implementation plan with multiple results", () => {
    expect(() =>
      assertReuseSearchPresent(
        mkPlan({
          reuseSearchResults: [
            { packageName: "@caia/ui", considered: true, decision: "selected", reason: "ok" },
            { packageName: "@chiefaia/http-client", considered: true, decision: "rejected", reason: "wrong shape" },
            { packageName: "@chiefaia/logger", considered: true, decision: "selected", reason: "ok" },
          ],
        })
      )
    ).not.toThrow();
  });

  it("bypasses for research plan with no results", () => {
    expect(() =>
      assertReuseSearchPresent(mkPlan({ planType: "research", reuseSearchResults: [] }))
    ).not.toThrow();
  });

  it("bypasses for spec plan", () => {
    expect(() =>
      assertReuseSearchPresent(mkPlan({ planType: "spec", reuseSearchResults: [] }))
    ).not.toThrow();
  });

  it("bypasses for architecture-change plan", () => {
    expect(() =>
      assertReuseSearchPresent(mkPlan({ planType: "architecture-change", reuseSearchResults: [] }))
    ).not.toThrow();
  });

  it("bypasses for process-change plan", () => {
    expect(() =>
      assertReuseSearchPresent(mkPlan({ planType: "process-change", reuseSearchResults: [] }))
    ).not.toThrow();
  });

  it("accepts an all-rejected list (planner did search, found nothing reusable)", () => {
    expect(() =>
      assertReuseSearchPresent(
        mkPlan({
          reuseSearchResults: [
            { packageName: "@caia/ui", considered: true, decision: "rejected", reason: "no fit" },
            { packageName: "@chiefaia/logger", considered: true, decision: "rejected", reason: "no fit" },
          ],
        })
      )
    ).not.toThrow();
  });
});

describe("assertReuseSearchPresent — refusals", () => {
  it("throws MISSING_REUSE_SEARCH when field absent", () => {
    const bad = { ...mkPlan() } as PlanWithReuse;
    // simulate missing field
    (bad as unknown as { reuseSearchResults?: unknown }).reuseSearchResults = undefined;
    try {
      assertReuseSearchPresent(bad);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReuseSearchGateError);
      expect((e as ReuseSearchGateError).code).toBe("MISSING_REUSE_SEARCH");
    }
  });

  it("throws EMPTY_REUSE_SEARCH for implementation plan with empty array", () => {
    try {
      assertReuseSearchPresent(mkPlan({ reuseSearchResults: [] }));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReuseSearchGateError);
      expect((e as ReuseSearchGateError).code).toBe("EMPTY_REUSE_SEARCH");
    }
  });

  it("throws MALFORMED_REUSE_RESULT for missing packageName", () => {
    try {
      assertReuseSearchPresent(
        mkPlan({
          reuseSearchResults: [
            { packageName: "", considered: true, decision: "selected", reason: "ok" } as ReuseSearchResult,
          ],
        })
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReuseSearchGateError);
      expect((e as ReuseSearchGateError).code).toBe("MALFORMED_REUSE_RESULT");
    }
  });

  it("throws MALFORMED_REUSE_RESULT for invalid decision", () => {
    try {
      assertReuseSearchPresent(
        mkPlan({
          reuseSearchResults: [
            {
              packageName: "@caia/ui",
              considered: true,
              decision: "maybe" as unknown as "selected",
              reason: "ok",
            },
          ],
        })
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ReuseSearchGateError);
      expect((e as ReuseSearchGateError).code).toBe("MALFORMED_REUSE_RESULT");
    }
  });

  it("throws MALFORMED_REUSE_RESULT for empty reason", () => {
    try {
      assertReuseSearchPresent(
        mkPlan({
          reuseSearchResults: [{ packageName: "@caia/ui", considered: true, decision: "selected", reason: "   " }],
        })
      );
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ReuseSearchGateError).code).toBe("MALFORMED_REUSE_RESULT");
    }
  });

  it("error carries planType + submissionId", () => {
    try {
      assertReuseSearchPresent(mkPlan({ reuseSearchResults: [], submissionId: "abc-123" }));
    } catch (e) {
      const err = e as ReuseSearchGateError;
      expect(err.planType).toBe("implementation");
      expect(err.submissionId).toBe("abc-123");
    }
  });
});

describe("submitPlanWithReuseGate", () => {
  it("delegates to ea.submitPlan when plan passes the gate", async () => {
    const ea = { submitPlan: vi.fn().mockResolvedValue({ status: "accepted", reviewId: "r1" }) };
    const out = await submitPlanWithReuseGate(mkPlan(), ea);
    expect(ea.submitPlan).toHaveBeenCalledOnce();
    expect(out).toEqual({ status: "accepted", reviewId: "r1" });
  });

  it("does NOT call ea.submitPlan when plan fails the gate", async () => {
    const ea = { submitPlan: vi.fn() };
    await expect(submitPlanWithReuseGate(mkPlan({ reuseSearchResults: [] }), ea)).rejects.toBeInstanceOf(
      ReuseSearchGateError
    );
    expect(ea.submitPlan).not.toHaveBeenCalled();
  });

  it("passes the whole plan through (forwards reuseSearchResults)", async () => {
    const ea = { submitPlan: vi.fn().mockResolvedValue("ok") };
    const plan = mkPlan();
    await submitPlanWithReuseGate(plan, ea);
    expect(ea.submitPlan).toHaveBeenCalledWith(plan);
  });
});

describe("hasSelectedReusePackage", () => {
  it("true when ≥1 selected", () => {
    expect(hasSelectedReusePackage(mkPlan())).toBe(true);
  });

  it("false when all rejected", () => {
    expect(
      hasSelectedReusePackage(
        mkPlan({
          reuseSearchResults: [
            { packageName: "@caia/ui", considered: true, decision: "rejected", reason: "no fit" },
          ],
        })
      )
    ).toBe(false);
  });

  it("false when results array missing", () => {
    const bad = { ...mkPlan() } as PlanWithReuse;
    (bad as unknown as { reuseSearchResults?: unknown }).reuseSearchResults = undefined;
    expect(hasSelectedReusePackage(bad)).toBe(false);
  });
});
