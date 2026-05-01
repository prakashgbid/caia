/** Canonical event names shared across all Pokerzeno sites. */
export const EVENTS = {
  // ── Page ──────────────────────────────────────────────────────────────────
  PAGE_VIEW: "page_view",

  // ── Game ──────────────────────────────────────────────────────────────────
  GAME_START: "game_start",
  GAME_END: "game_end",
  BET_PLACED: "bet_placed",
  ACTION_TAKEN: "action_taken",
  WIN: "win",
  LOSS: "loss",
  VARIANT_CHANGED: "variant_changed",
  DIFFICULTY_SELECTED: "difficulty_selected",

  // ── Content ───────────────────────────────────────────────────────────────
  LESSON_STARTED: "lesson_started",
  LESSON_COMPLETED: "lesson_completed",
  ARTICLE_READ: "article_read",
  PAPER_READ: "paper_read",
  VIDEO_PLAYED: "video_played",

  // ── Community ─────────────────────────────────────────────────────────────
  GROUP_JOINED: "group_joined",
  THREAD_POSTED: "thread_posted",
  COMMENT_ADDED: "comment_added",
  REACTION_ADDED: "reaction_added",

  // ── Commerce ──────────────────────────────────────────────────────────────
  PRODUCT_VIEWED: "product_viewed",
  ADD_TO_CART: "add_to_cart",
  REMOVE_FROM_CART: "remove_from_cart",
  CHECKOUT_STARTED: "checkout_started",
  CHECKOUT_ABANDONED: "checkout_abandoned",
  CHECKOUT_COMPLETED: "checkout_completed",

  // ── Cart Abandonment ──────────────────────────────────────────────────────
  CART_VIEWED: "cart_viewed",
  CART_UPDATED: "cart_updated",
  CART_ITEM_REMOVED: "cart_item_removed",
  CART_ABANDONED: "cart_abandoned",
  CART_CLEARED: "cart_cleared",
  CART_RECOVERY_EMAIL_SENT: "cart_recovery_email_sent",
  CART_RECOVERY_EMAIL_CLICKED: "cart_recovery_email_clicked",
  CART_RECOVERED: "cart_recovered",

  // ── CTA / UI ──────────────────────────────────────────────────────────────
  CTA_CLICKED: "cta_clicked",

  // ── Engagement ────────────────────────────────────────────────────────────
  SCROLL_DEPTH: "scroll_depth",
  TIME_ON_PAGE: "time_on_page",
  FULLSCREEN_TOGGLED: "fullscreen_toggled",
  SOUND_TOGGLED: "sound_toggled",
  USER_PREFERENCE_CHANGED: "user_preference_changed",

  // ── Conversion ────────────────────────────────────────────────────────────
  SIGNUP: "signup",
  EMAIL_CAPTURED: "email_captured",
  FIRST_BET: "first_bet",
  CERTIFICATION_ACHIEVED: "certification_achieved",
  REFERRAL_SENT: "referral_sent",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
