import { EVENTS } from "./taxonomy";
import { sendEvent } from "../integrations/ga4";

export interface ProductParams {
  product_id: string;
  product_name?: string;
  category?: string;
  price?: number;
  currency?: string;
}

export interface CartItem extends ProductParams {
  quantity?: number;
}

export interface CartParams {
  cart_id?: string;
  value?: number;
  item_count?: number;
  currency?: string;
  items?: CartItem[];
}

export function trackProductViewed(params: ProductParams): void {
  sendEvent(EVENTS.PRODUCT_VIEWED, params);
}

export function trackAddToCart(params: CartItem): void {
  sendEvent(EVENTS.ADD_TO_CART, params);
}

export function trackRemoveFromCart(params: CartItem): void {
  sendEvent(EVENTS.REMOVE_FROM_CART, params);
}

export function trackCartViewed(params: CartParams): void {
  sendEvent(EVENTS.CART_VIEWED, params);
}

export function trackCartUpdated(params: CartParams): void {
  sendEvent(EVENTS.CART_UPDATED, params);
}

export function trackCartItemRemoved(params: CartItem & { cart_id?: string }): void {
  sendEvent(EVENTS.CART_ITEM_REMOVED, params);
}

export function trackCartAbandoned(params: CartParams & { time_in_cart_seconds?: number }): void {
  sendEvent(EVENTS.CART_ABANDONED, params);
}

export function trackCartCleared(params: Pick<CartParams, "cart_id" | "item_count">): void {
  sendEvent(EVENTS.CART_CLEARED, params);
}

export function trackCartRecoveryEmailSent(params: { cart_id?: string; email_hash?: string }): void {
  sendEvent(EVENTS.CART_RECOVERY_EMAIL_SENT, params);
}

export function trackCartRecoveryEmailClicked(params: { cart_id?: string; campaign_id?: string }): void {
  sendEvent(EVENTS.CART_RECOVERY_EMAIL_CLICKED, params);
}

export function trackCartRecovered(params: CartParams): void {
  sendEvent(EVENTS.CART_RECOVERED, params);
}

export function trackCheckoutStarted(params: CartParams): void {
  sendEvent(EVENTS.CHECKOUT_STARTED, params);
}

export function trackCheckoutAbandoned(params: CartParams & { step?: string }): void {
  sendEvent(EVENTS.CHECKOUT_ABANDONED, params);
}

export function trackCheckoutCompleted(params: CartParams & { order_id?: string; coupon?: string }): void {
  sendEvent(EVENTS.CHECKOUT_COMPLETED, params);
}
