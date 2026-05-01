import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCartAbandonment } from "../src/useCartAbandonment";
import { _resetForTesting, initGa4, loadGa4Script } from "../src/integrations/ga4";

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };

function setupGa4(): ReturnType<typeof vi.fn> {
  initGa4("G-TESTID12345");
  loadGa4Script("G-TESTID12345");
  // loadGa4Script overwrites window.gtag — re-spy on the new function
  const spy = vi.fn((...args: unknown[]) => {
    (window as GtagWindow).dataLayer?.push(args);
  });
  (window as GtagWindow).gtag = spy;
  (window as GtagWindow).dataLayer = [];
  return spy;
}

function gtagEvents(spy: ReturnType<typeof vi.fn>): Array<{ name: string; params: unknown }> {
  return spy.mock.calls
    .filter((c) => c[0] === "event")
    .map((c) => ({ name: c[1] as string, params: c[2] }));
}

beforeEach(() => {
  _resetForTesting();
  (window as GtagWindow).dataLayer = [];
  (window as GtagWindow).gtag = vi.fn((...args: unknown[]) => {
    (window as GtagWindow).dataLayer?.push(args);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Rendering + cart_viewed ───────────────────────────────────────────────────

describe("useCartAbandonment — cart_viewed on mount", () => {
  it("fires cart_viewed when GA4 is loaded", () => {
    const spy = setupGa4();
    renderHook(() => useCartAbandonment({ cart_id: "c1", value: 50 }));
    const events = gtagEvents(spy);
    expect(events.some((e) => e.name === "cart_viewed")).toBe(true);
    const viewedEvent = events.find((e) => e.name === "cart_viewed");
    expect(viewedEvent?.params).toMatchObject({ cart_id: "c1", value: 50 });
  });

  it("does NOT fire cart_viewed when skipViewedEvent is true", () => {
    const spy = setupGa4();
    renderHook(() => useCartAbandonment({ cart_id: "c2", skipViewedEvent: true }));
    const events = gtagEvents(spy);
    expect(events.some((e) => e.name === "cart_viewed")).toBe(false);
  });

  it("does not throw when GA4 is not loaded", () => {
    expect(() => {
      renderHook(() => useCartAbandonment({ cart_id: "c3" }));
    }).not.toThrow();
  });
});

// ── markAbandoned ─────────────────────────────────────────────────────────────

describe("useCartAbandonment — markAbandoned", () => {
  it("fires cart_abandoned with cart params when GA4 is loaded", () => {
    const spy = setupGa4();
    const { result } = renderHook(() =>
      useCartAbandonment({ cart_id: "c10", value: 99.99, item_count: 3 }),
    );
    act(() => result.current.markAbandoned());
    const events = gtagEvents(spy);
    const abandonedEvent = events.find((e) => e.name === "cart_abandoned");
    expect(abandonedEvent).toBeDefined();
    expect(abandonedEvent?.params).toMatchObject({ cart_id: "c10", value: 99.99, item_count: 3 });
  });

  it("includes time_in_cart_seconds", () => {
    const spy = setupGa4();
    const { result } = renderHook(() => useCartAbandonment({ cart_id: "c11" }));
    act(() => result.current.markAbandoned());
    const abandonedEvent = gtagEvents(spy).find((e) => e.name === "cart_abandoned");
    expect((abandonedEvent?.params as Record<string, unknown>)?.time_in_cart_seconds).toBeGreaterThanOrEqual(0);
  });

  it("is idempotent — fires cart_abandoned only once", () => {
    const spy = setupGa4();
    const { result } = renderHook(() => useCartAbandonment({ cart_id: "c12" }));
    act(() => {
      result.current.markAbandoned();
      result.current.markAbandoned();
      result.current.markAbandoned();
    });
    const abandonedCount = gtagEvents(spy).filter((e) => e.name === "cart_abandoned").length;
    expect(abandonedCount).toBe(1);
  });

  it("does not throw when GA4 is not loaded", () => {
    const { result } = renderHook(() => useCartAbandonment({ cart_id: "c13" }));
    expect(() => act(() => result.current.markAbandoned())).not.toThrow();
  });
});

// ── markRecovered ─────────────────────────────────────────────────────────────

describe("useCartAbandonment — markRecovered", () => {
  it("fires cart_recovered when GA4 is loaded", () => {
    const spy = setupGa4();
    const { result } = renderHook(() =>
      useCartAbandonment({ cart_id: "c20", value: 75 }),
    );
    act(() => result.current.markRecovered());
    const recoveredEvent = gtagEvents(spy).find((e) => e.name === "cart_recovered");
    expect(recoveredEvent).toBeDefined();
    expect(recoveredEvent?.params).toMatchObject({ cart_id: "c20", value: 75 });
  });

  it("is idempotent — fires cart_recovered only once", () => {
    const spy = setupGa4();
    const { result } = renderHook(() => useCartAbandonment({ cart_id: "c21" }));
    act(() => {
      result.current.markRecovered();
      result.current.markRecovered();
    });
    const recoveredCount = gtagEvents(spy).filter((e) => e.name === "cart_recovered").length;
    expect(recoveredCount).toBe(1);
  });

  it("markRecovered prevents subsequent markAbandoned from firing", () => {
    const spy = setupGa4();
    const { result } = renderHook(() => useCartAbandonment({ cart_id: "c22" }));
    act(() => {
      result.current.markRecovered();
      result.current.markAbandoned();
    });
    const events = gtagEvents(spy);
    expect(events.some((e) => e.name === "cart_recovered")).toBe(true);
    expect(events.some((e) => e.name === "cart_abandoned")).toBe(false);
  });
});

// ── beforeunload integration ──────────────────────────────────────────────────

describe("useCartAbandonment — beforeunload", () => {
  it("registers a beforeunload listener on mount", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => useCartAbandonment({ cart_id: "c30" }));
    expect(addSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("removes the beforeunload listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useCartAbandonment({ cart_id: "c31" }));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("beforeunload", expect.any(Function));
  });

  it("fires cart_abandoned when beforeunload is dispatched", () => {
    const spy = setupGa4();
    renderHook(() => useCartAbandonment({ cart_id: "c32", value: 40 }));
    window.dispatchEvent(new Event("beforeunload"));
    const abandonedEvent = gtagEvents(spy).find((e) => e.name === "cart_abandoned");
    expect(abandonedEvent).toBeDefined();
    expect(abandonedEvent?.params).toMatchObject({ cart_id: "c32", value: 40 });
  });
});

// ── getTimeInCartSeconds ──────────────────────────────────────────────────────

describe("useCartAbandonment — getTimeInCartSeconds", () => {
  it("returns a non-negative number", () => {
    const { result } = renderHook(() => useCartAbandonment({}));
    expect(result.current.getTimeInCartSeconds()).toBeGreaterThanOrEqual(0);
  });
});
