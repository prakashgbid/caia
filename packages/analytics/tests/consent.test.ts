import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadPreferences,
  savePreferences,
  shouldAutoReject,
  ACCEPT_ALL,
  REJECT_ALL,
  ESSENTIAL_ONLY,
  DEFAULT_PREFERENCES,
} from "../src/consent/helpers";

beforeEach(() => {
  localStorage.clear();
  document.cookie = "pokerzeno.consent=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
  Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true, writable: true });
  Object.defineProperty(navigator, "globalPrivacyControl", { value: undefined, configurable: true, writable: true });
});

describe("loadPreferences", () => {
  it("returns null when nothing stored", () => {
    expect(loadPreferences()).toBeNull();
  });

  it("returns stored preferences", () => {
    savePreferences(ACCEPT_ALL);
    const loaded = loadPreferences();
    expect(loaded).toEqual(ACCEPT_ALL);
  });

  it("returns null on corrupted JSON", () => {
    localStorage.setItem("pokerzeno.consent", "not-json{{{");
    expect(loadPreferences()).toBeNull();
  });
});

describe("savePreferences", () => {
  it("persists to localStorage", () => {
    savePreferences(ESSENTIAL_ONLY);
    const raw = localStorage.getItem("pokerzeno.consent");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.analytics).toBe("denied");
    expect(parsed.functional).toBe("granted");
  });
});

describe("shouldAutoReject", () => {
  it("returns false by default", () => {
    expect(shouldAutoReject()).toBe(false);
  });

  it("returns true when doNotTrack is '1'", () => {
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    expect(shouldAutoReject()).toBe(true);
  });

  it("returns true when globalPrivacyControl is true", () => {
    Object.defineProperty(navigator, "globalPrivacyControl", { value: true, configurable: true });
    expect(shouldAutoReject()).toBe(true);
  });
});

describe("preset consent states", () => {
  it("ACCEPT_ALL grants everything", () => {
    expect(ACCEPT_ALL.analytics).toBe("granted");
    expect(ACCEPT_ALL.marketing).toBe("granted");
    expect(ACCEPT_ALL.functional).toBe("granted");
  });

  it("REJECT_ALL denies everything", () => {
    expect(REJECT_ALL.analytics).toBe("denied");
    expect(REJECT_ALL.marketing).toBe("denied");
    expect(REJECT_ALL.functional).toBe("denied");
  });

  it("ESSENTIAL_ONLY denies analytics and marketing", () => {
    expect(ESSENTIAL_ONLY.analytics).toBe("denied");
    expect(ESSENTIAL_ONLY.marketing).toBe("denied");
    expect(ESSENTIAL_ONLY.functional).toBe("granted");
  });

  it("DEFAULT_PREFERENCES marks everything as pending", () => {
    expect(DEFAULT_PREFERENCES.analytics).toBe("pending");
  });
});
