import { EVENTS } from "./taxonomy";
import { sendEvent } from "../integrations/ga4";

export function trackScrollDepth(pct: 25 | 50 | 75 | 90 | 100, page?: string): void {
  sendEvent(EVENTS.SCROLL_DEPTH, { scroll_pct: pct, page });
}

export function trackTimeOnPage(seconds: number, page?: string): void {
  sendEvent(EVENTS.TIME_ON_PAGE, { duration_sec: seconds, page });
}

export function trackFullscreenToggled(entered: boolean): void {
  sendEvent(EVENTS.FULLSCREEN_TOGGLED, { entered });
}

export function trackSoundToggled(muted: boolean): void {
  sendEvent(EVENTS.SOUND_TOGGLED, { muted });
}

export function trackUserPreferenceChanged(key: string, value: string | number | boolean): void {
  sendEvent(EVENTS.USER_PREFERENCE_CHANGED, { preference_key: key, preference_value: String(value) });
}
