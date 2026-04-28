// ── Provider + hook ───────────────────────────────────────────────────────────
export { AnalyticsProvider } from "./AnalyticsProvider";
export { useAnalytics } from "./useAnalytics";

// ── Consent ───────────────────────────────────────────────────────────────────
export { ConsentProvider, useConsent } from "./consent/ConsentProvider";
export { ConsentBanner } from "./consent/ConsentBanner";
export {
  loadPreferences,
  savePreferences,
  shouldAutoReject,
  ACCEPT_ALL,
  REJECT_ALL,
  ESSENTIAL_ONLY,
} from "./consent/helpers";
export type { ConsentPreferences, ConsentChoice } from "./consent/helpers";

// ── Event taxonomy + typed helpers ────────────────────────────────────────────
export { EVENTS } from "./events/taxonomy";
export type { EventName } from "./events/taxonomy";

export { trackGameStart, trackGameEnd, trackBetPlaced, trackActionTaken, trackVariantChanged, trackDifficultySelected } from "./events/game";
export type { GameStartParams, GameEndParams, BetPlacedParams, ActionTakenParams } from "./events/game";

export { trackLessonStarted, trackLessonCompleted, trackArticleRead, trackPaperRead, trackVideoPlayed } from "./events/content";

export { trackGroupJoined, trackThreadPosted, trackCommentAdded, trackReactionAdded } from "./events/community";

export { trackProductViewed, trackAddToCart, trackCheckoutStarted } from "./events/commerce";
export type { ProductParams } from "./events/commerce";

export { trackCTAClicked } from "./events/cta";
export type { CTAClickedParams } from "./events/cta";

export { trackScrollDepth, trackTimeOnPage, trackFullscreenToggled, trackSoundToggled, trackUserPreferenceChanged } from "./events/engagement";

export { trackSignup, trackEmailCaptured, trackFirstBet, trackCertificationAchieved, trackReferralSent } from "./events/conversion";

// ── Low-level GA4 (use sparingly — prefer typed helpers above) ────────────────
export { sendEvent, isValidMeasurementId } from "./integrations/ga4";
