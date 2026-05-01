import { describe, it, expect, beforeEach, vi } from "vitest";
import { EVENTS } from "../src/events/taxonomy";
import {
  trackCartViewed,
  trackCartUpdated,
  trackCartItemRemoved,
  trackCartAbandoned,
  trackCartCleared,
  trackCartRecoveryEmailSent,
  trackCartRecoveryEmailClicked,
  trackCartRecovered,
} from "../src/events/commerce";
import { initGa4, loadGa4Script, _resetForTesting } from "../src/integrations/ga4";

type GtagWindow = Window & { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void };

beforeEach(() => {
  _resetForTesting();
  (window as GtagWindow).dataLayer = [];
  (window as GtagWindow).gtag = vi.fn((...args: unknown[]) => {
    (window as GtagWindow).dataLayer?.push(args);
  });
  // Mark GA4 as loaded so sendEvent passes through.
  // We patch the module-level state via initGa4 + force-load flag workaround.
});

describe("cart abandonment event constants", () => {
  it("has all cart abandonment event names", () => {
    expect(EVENTS.CART_VIEWED).toBe("cart_viewed");
    expect(EVENTS.CART_ITEM_REMOVED).toBe("cart_item_removed");
    expect(EVENTS.CART_ABANDONED).toBe("cart_abandoned");
    expect(EVENTS.CART_CLEARED).toBe("cart_cleared");
    expect(EVENTS.CART_RECOVERY_EMAIL_SENT).toBe("cart_recovery_email_sent");
    expect(EVENTS.CART_RECOVERY_EMAIL_CLICKED).toBe("cart_recovery_email_clicked");
    expect(EVENTS.CART_RECOVERED).toBe("cart_recovered");
  });

  it("taxonomy has at least 36 events after cart events added", () => {
    expect(Object.keys(EVENTS).length).toBeGreaterThanOrEqual(36);
  });
});

describe("cart abandonment typed helpers (no-op before GA4 loaded)", () => {
  it("trackCartViewed does not throw", () => {
    expect(() => trackCartViewed({ cart_id: "c1", value: 99.99, item_count: 2 })).not.toThrow();
  });

  it("trackCartItemRemoved does not throw", () => {
    expect(() =>
      trackCartItemRemoved({ product_id: "p42", price: 29.99, cart_id: "c1" }),
    ).not.toThrow();
  });

  it("trackCartAbandoned does not throw", () => {
    expect(() =>
      trackCartAbandoned({ cart_id: "c1", value: 49.0, item_count: 1, time_in_cart_seconds: 120 }),
    ).not.toThrow();
  });

  it("trackCartCleared does not throw", () => {
    expect(() => trackCartCleared({ cart_id: "c1", item_count: 3 })).not.toThrow();
  });

  it("trackCartRecoveryEmailSent does not throw", () => {
    expect(() =>
      trackCartRecoveryEmailSent({ cart_id: "c1", email_hash: "abc123" }),
    ).not.toThrow();
  });

  it("trackCartRecoveryEmailClicked does not throw", () => {
    expect(() =>
      trackCartRecoveryEmailClicked({ cart_id: "c1", campaign_id: "camp-1" }),
    ).not.toThrow();
  });

  it("trackCartRecovered does not throw", () => {
    expect(() =>
      trackCartRecovered({ cart_id: "c1", value: 99.0 }),
    ).not.toThrow();
  });
});

describe("cart abandonment event shape validation", () => {
  it("CartParams type accepts empty params (all optional)", () => {
    expect(() => trackCartViewed({})).not.toThrow();
  });

  it("CartItem accepts full shape", () => {
    const item = {
      product_id: "p1",
      product_name: "Widget",
      category: "tools",
      price: 9.99,
      quantity: 2,
      currency: "USD",
    };
    expect(() =>
      trackCartAbandoned({ cart_id: "c1", items: [item] }),
    ).not.toThrow();
  });

  it("trackCartRecovered accepts CartParams fields", () => {
    expect(() =>
      trackCartRecovered({ cart_id: "c2", value: 25, item_count: 1 }),
    ).not.toThrow();
  });
});

describe("initGa4 guard — events no-op before GA4 is initialised", () => {
  it("sendEvent is suppressed before initGa4 is called", () => {
    const gtagSpy = vi.spyOn(window as GtagWindow, "gtag" as keyof GtagWindow);
    trackCartAbandoned({ cart_id: "c-noop", value: 10 });
    expect(gtagSpy).not.toHaveBeenCalled();
  });

  it("initGa4 alone (without script load) keeps events no-op", () => {
    initGa4("G-TESTID12345");
    const gtagSpy = vi.spyOn(window as GtagWindow, "gtag" as keyof GtagWindow);
    trackCartViewed({ cart_id: "c-noop2" });
    // _loaded is still false — sendEvent is suppressed
    expect(gtagSpy).not.toHaveBeenCalled();
  });
});

// ── Events fire when GA4 is loaded ───────────────────────────────────────────

function setupLoadedGa4(): ReturnType<typeof vi.fn> {
  initGa4("G-TESTID12345");
  loadGa4Script("G-TESTID12345");
  // loadGa4Script sets _loaded=true and overwrites window.gtag — re-spy
  const spy = vi.fn((...args: unknown[]) => {
    (window as GtagWindow).dataLayer?.push(args);
  });
  (window as GtagWindow).gtag = spy;
  (window as GtagWindow).dataLayer = [];
  return spy;
}

function eventNames(spy: ReturnType<typeof vi.fn>): string[] {
  return spy.mock.calls.filter((c) => c[0] === "event").map((c) => c[1] as string);
}

describe("cart abandonment helpers fire events when GA4 is loaded", () => {
  it("trackCartViewed fires cart_viewed", () => {
    const spy = setupLoadedGa4();
    trackCartViewed({ cart_id: "c1", value: 10 });
    expect(eventNames(spy)).toContain("cart_viewed");
  });

  it("trackCartUpdated fires cart_updated", () => {
    const spy = setupLoadedGa4();
    trackCartUpdated({ cart_id: "c1", item_count: 2 });
    expect(eventNames(spy)).toContain("cart_updated");
  });

  it("trackCartItemRemoved fires cart_item_removed", () => {
    const spy = setupLoadedGa4();
    trackCartItemRemoved({ product_id: "p1", cart_id: "c1" });
    expect(eventNames(spy)).toContain("cart_item_removed");
  });

  it("trackCartAbandoned fires cart_abandoned with time_in_cart_seconds", () => {
    const spy = setupLoadedGa4();
    trackCartAbandoned({ cart_id: "c1", value: 49, time_in_cart_seconds: 120 });
    const call = spy.mock.calls.find((c) => c[0] === "event" && c[1] === "cart_abandoned");
    expect(call).toBeDefined();
    expect(call?.[2]).toMatchObject({ cart_id: "c1", value: 49, time_in_cart_seconds: 120 });
  });

  it("trackCartCleared fires cart_cleared", () => {
    const spy = setupLoadedGa4();
    trackCartCleared({ cart_id: "c1", item_count: 3 });
    expect(eventNames(spy)).toContain("cart_cleared");
  });

  it("trackCartRecoveryEmailSent fires cart_recovery_email_sent", () => {
    const spy = setupLoadedGa4();
    trackCartRecoveryEmailSent({ cart_id: "c1", email_hash: "abc" });
    expect(eventNames(spy)).toContain("cart_recovery_email_sent");
  });

  it("trackCartRecoveryEmailClicked fires cart_recovery_email_clicked", () => {
    const spy = setupLoadedGa4();
    trackCartRecoveryEmailClicked({ cart_id: "c1", campaign_id: "camp1" });
    expect(eventNames(spy)).toContain("cart_recovery_email_clicked");
  });

  it("trackCartRecovered fires cart_recovered", () => {
    const spy = setupLoadedGa4();
    trackCartRecovered({ cart_id: "c1", value: 99 });
    expect(eventNames(spy)).toContain("cart_recovered");
  });
});
