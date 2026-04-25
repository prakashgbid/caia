/** Google Analytics 4 integration via gtag.js */

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
  }
}

const PLACEHOLDER_PREFIX = "G-PLACEHOLDER";

let _measurementId: string | null = null;
let _debug = false;
let _loaded = false;

/** Returns true if the measurement ID is a real GA4 property ID. */
export function isValidMeasurementId(id: string | undefined | null): boolean {
  if (!id) return false;
  if (id.startsWith(PLACEHOLDER_PREFIX)) return false;
  return /^G-[A-Z0-9]{6,12}$/.test(id);
}

/** Inject the gtag.js script tag. Call only once, after consent is granted. */
export function loadGa4Script(measurementId: string): void {
  if (_loaded) return;
  if (!isValidMeasurementId(measurementId)) {
    if (_debug) console.debug("[analytics] GA4: placeholder ID — script not loaded");
    return;
  }
  _loaded = true;

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function (...args: unknown[]) {
    window.dataLayer.push(args);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    // IP anonymisation is GA4 default; assert via send_page_view:false (we fire manually)
    send_page_view: false,
    anonymize_ip: true,
    ...(process.env.NODE_ENV === "development" ? { debug_mode: true } : {}),
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
}

export function initGa4(measurementId: string, debug = false): void {
  _measurementId = measurementId;
  _debug = debug;
}

export function sendPageView(params: {
  page_location: string;
  page_title: string;
  page_referrer?: string;
  app_name?: string;
}): void {
  if (!_loaded || !_measurementId) return;
  if (_debug) console.debug("[analytics] page_view", params);
  try {
    window.gtag("event", "page_view", {
      ...params,
      send_to: _measurementId,
    });
  } catch {}
}

export function sendEvent(eventName: string, params?: object): void {
  if (!_loaded || !_measurementId) {
    if (_debug) console.debug("[analytics] (no-op — not loaded)", eventName, params);
    return;
  }
  if (_debug) console.debug("[analytics]", eventName, params);
  try {
    window.gtag("event", eventName, {
      ...(params ?? {}),
      send_to: _measurementId,
    });
  } catch {}
}

export function setUserProperty(key: string, value: string): void {
  if (!_loaded || !_measurementId) return;
  try {
    window.gtag("set", "user_properties", { [key]: value });
  } catch {}
}

export function identifyUser(userId: string): void {
  if (!_loaded || !_measurementId) return;
  try {
    window.gtag("config", _measurementId, { user_id: userId });
  } catch {}
}

export function getMeasurementId(): string | null {
  return _measurementId;
}

export function isLoaded(): boolean {
  return _loaded;
}

/** For testing: reset singleton state. */
export function _resetForTesting(): void {
  _measurementId = null;
  _debug = false;
  _loaded = false;
}
