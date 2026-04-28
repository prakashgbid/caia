import { EVENTS } from "./taxonomy";
import { sendEvent } from "../integrations/ga4";

export interface CTAClickedParams {
  name: string;
  position?: string;
  page?: string;
  destination?: string;
}

export function trackCTAClicked(params: CTAClickedParams): void {
  sendEvent(EVENTS.CTA_CLICKED, params);
}
