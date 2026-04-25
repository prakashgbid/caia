import { EVENTS } from "./taxonomy";
import { sendEvent } from "../integrations/ga4";

export interface ProductParams {
  product_id: string;
  product_name?: string;
  category?: string;
  price?: number;
  currency?: string;
}

export function trackProductViewed(params: ProductParams): void {
  sendEvent(EVENTS.PRODUCT_VIEWED, params);
}

export function trackAddToCart(params: ProductParams & { quantity?: number }): void {
  sendEvent(EVENTS.ADD_TO_CART, params);
}

export function trackCheckoutStarted(params: { value?: number; item_count?: number; currency?: string }): void {
  sendEvent(EVENTS.CHECKOUT_STARTED, params);
}
