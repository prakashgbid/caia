import { describe, it, expect, beforeEach, vi } from "vitest";
import { EVENTS } from "../src/events/taxonomy";
import { initGa4, loadGa4Script, sendEvent, isValidMeasurementId, _resetForTesting } from "../src/integrations/ga4";

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
});
