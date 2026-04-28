"use client";

export type ConsentChoice = "granted" | "denied" | "pending";

export interface ConsentPreferences {
  analytics: ConsentChoice;
  marketing: ConsentChoice;
  functional: ConsentChoice;
}

export const DEFAULT_PREFERENCES: ConsentPreferences = {
  analytics: "pending",
  marketing: "pending",
  functional: "pending",
};

const STORAGE_KEY = "pokerzeno.consent";

/** Returns true if the user's browser signals DNT or GPC. Auto-deny in that case. */
export function shouldAutoReject(): boolean {
  if (typeof navigator === "undefined") return false;
  if (navigator.doNotTrack === "1") return true;
  // Global Privacy Control — https://globalprivacycontrol.org
  if ((navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return true;
  return false;
}

/** Load stored preferences from localStorage. Returns null if never set. */
export function loadPreferences(): ConsentPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ConsentPreferences;
  } catch {
    return null;
  }
}

/** Persist preferences to localStorage and a SameSite=Strict cookie. */
export function savePreferences(prefs: ConsentPreferences): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    const days = 365;
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${STORAGE_KEY}=${encodeURIComponent(JSON.stringify(prefs))}; expires=${expires}; path=/; SameSite=Strict`;
  } catch {}
}

export const ACCEPT_ALL: ConsentPreferences = {
  analytics: "granted",
  marketing: "granted",
  functional: "granted",
};

export const REJECT_ALL: ConsentPreferences = {
  analytics: "denied",
  marketing: "denied",
  functional: "denied",
};

export const ESSENTIAL_ONLY: ConsentPreferences = {
  analytics: "denied",
  marketing: "denied",
  functional: "granted",
};
