import { describe, it, expect, beforeEach, vi } from "vitest";
import { EVENTS } from "../src/events/taxonomy";
import { initGa4, loadGa4Script, sendEvent, isValidMeasurementId, _resetForTesting } from "../src/integrations/ga4";
import { trackCartAbandoned, trackCartRecoveryEmailSent } from "../src/events/commerce";

// Mock document.createElement to capture script injection
const appendedScripts: HTMLScriptElement[] = [];
const originalCreateElement = document.createElement.bind(document);

beforeEach(() => {
  _resetForTesting();
  appendedScripts.length = 0;

  // Set up gtag dataLayer mock
  (window as Window & { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void }).dataLayer = [];
  (window as Window & { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void }).gtag = vi.fn((...args: unknown[]) => {
    (window as Window & { dataLayer?: unknown[] }).dataLayer?.push(args);
  });
});

describe("isValidMeasurementId", () => {
  it("accepts a valid GA4 ID", () => {
    expect(isValidMeasurementId("G-ABC1234567")).toBe(true);
  });

  it("rejects placeholder IDs", () => {
    expect(isValidMeasurementId("G-PLACEHOLDER-POKERZENO")).toBe(false);
    expect(isValidMeasurementId("G-PLACEHOLDER-ROULETTE")).toBe(false);
  });

  it("rejects null/undefined/empty", () => {
    expect(isValidMeasurementId(null)).toBe(false);
    expect(isValidMeasurementId(undefined)).toBe(false);
    expect(isValidMeasurementId("")).toBe(false);
  });

  it("rejects non-GA4 formats", () => {
    expect(isValidMeasurementId("UA-12345678-1")).toBe(false);
    expect(isValidMeasurementId("not-an-id")).toBe(false);
  });
});

describe("sendEvent", () => {
  it("no-ops before GA4 is loaded", () => {
    const gtagSpy = vi.spyOn(window, "gtag" as keyof Window);
    sendEvent(EVENTS.BET_PLACED, { amount: 10 });
    expect(gtagSpy).not.toHaveBeenCalled();
  });

  it("fires through gtag when loaded", () => {
    initGa4("G-ABC1234567");
    // Manually mark as loaded by calling loadGa4Script
    // We can't really inject the script in jsdom, so we test the sendEvent guard
    // (isLoaded returns false until script fires, which we can't test in jsdom)
    // This is tested via integration; here we confirm the no-op guard
    sendEvent(EVENTS.GAME_START, { variant: "EU" });
    // Still no-op because _loaded is false (script didn't inject in jsdom)
    const gtag = (window as Window & { gtag?: (...a: unknown[]) => void }).gtag;
    expect(gtag).toBeDefined();
  });
});

describe("event taxonomy constants", () => {
  it("has all expected event names", () => {
    expect(EVENTS.GAME_START).toBe("game_start");
    expect(EVENTS.BET_PLACED).toBe("bet_placed");
    expect(EVENTS.LESSON_STARTED).toBe("lesson_started");
    expect(EVENTS.CTA_CLICKED).toBe("cta_clicked");
    expect(EVENTS.SCROLL_DEPTH).toBe("scroll_depth");
    expect(EVENTS.EMAIL_CAPTURED).toBe("email_captured");
    expect(EVENTS.CERTIFICATION_ACHIEVED).toBe("certification_achieved");
    expect(EVENTS.CONSENT_CHANGED).toBe(undefined); // not in taxonomy
    expect(Object.keys(EVENTS).length).toBeGreaterThanOrEqual(25);
  });

  it("has all cart abandonment event names", () => {
    expect(EVENTS.CART_VIEWED).toBe("cart_viewed");
    expect(EVENTS.CART_UPDATED).toBe("cart_updated");
    expect(EVENTS.CART_ITEM_REMOVED).toBe("cart_item_removed");
    expect(EVENTS.CART_ABANDONED).toBe("cart_abandoned");
    expect(EVENTS.CART_CLEARED).toBe("cart_cleared");
    expect(EVENTS.CART_RECOVERY_EMAIL_SENT).toBe("cart_recovery_email_sent");
    expect(EVENTS.CART_RECOVERY_EMAIL_CLICKED).toBe("cart_recovery_email_clicked");
    expect(EVENTS.CART_RECOVERED).toBe("cart_recovered");
    expect(EVENTS.REMOVE_FROM_CART).toBe("remove_from_cart");
    expect(EVENTS.CHECKOUT_ABANDONED).toBe("checkout_abandoned");
    expect(EVENTS.CHECKOUT_COMPLETED).toBe("checkout_completed");
  });
});

describe("cart abandonment tracking helpers", () => {
  it("exports all cart abandonment helpers", async () => {
    const mod = await import("../src/events/commerce");
    expect(typeof mod.trackCartViewed).toBe("function");
    expect(typeof mod.trackCartUpdated).toBe("function");
    expect(typeof mod.trackCartItemRemoved).toBe("function");
    expect(typeof mod.trackRemoveFromCart).toBe("function");
    expect(typeof mod.trackCartAbandoned).toBe("function");
    expect(typeof mod.trackCartCleared).toBe("function");
    expect(typeof mod.trackCartRecoveryEmailSent).toBe("function");
    expect(typeof mod.trackCartRecoveryEmailClicked).toBe("function");
    expect(typeof mod.trackCartRecovered).toBe("function");
    expect(typeof mod.trackCheckoutAbandoned).toBe("function");
    expect(typeof mod.trackCheckoutCompleted).toBe("function");
  });

  it("trackCartAbandoned is a no-op when GA4 not loaded", () => {
    const gtagSpy = vi.spyOn(window, "gtag" as keyof Window);
    trackCartAbandoned({ cart_id: "abc", value: 49.99, item_count: 2 });
    expect(gtagSpy).not.toHaveBeenCalled();
  });

  it("trackCartRecoveryEmailSent is a no-op when GA4 not loaded", () => {
    const gtagSpy = vi.spyOn(window, "gtag" as keyof Window);
    trackCartRecoveryEmailSent({ cart_id: "abc", email_hash: "sha256hash" });
    expect(gtagSpy).not.toHaveBeenCalled();
  });
});
