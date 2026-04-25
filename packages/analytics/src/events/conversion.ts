import { EVENTS } from "./taxonomy";
import { sendEvent } from "../integrations/ga4";

export function trackSignup(method?: string): void {
  sendEvent(EVENTS.SIGNUP, { method });
}

export function trackEmailCaptured(list_name: string, page?: string): void {
  sendEvent(EVENTS.EMAIL_CAPTURED, { list_name, page });
}

export function trackFirstBet(params: { variant: string; amount: number }): void {
  sendEvent(EVENTS.FIRST_BET, params);
}

export function trackCertificationAchieved(params: { cert_id: string; cert_name?: string; score?: number }): void {
  sendEvent(EVENTS.CERTIFICATION_ACHIEVED, params);
}

export function trackReferralSent(method?: string): void {
  sendEvent(EVENTS.REFERRAL_SENT, { method });
}
