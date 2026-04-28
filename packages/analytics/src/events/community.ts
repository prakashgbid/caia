import { EVENTS } from "./taxonomy";
import { sendEvent } from "../integrations/ga4";

export function trackGroupJoined(params: { group_id: string; group_name?: string }): void {
  sendEvent(EVENTS.GROUP_JOINED, params);
}

export function trackThreadPosted(params: { thread_id?: string; forum?: string }): void {
  sendEvent(EVENTS.THREAD_POSTED, params);
}

export function trackCommentAdded(params: { thread_id?: string; position?: number }): void {
  sendEvent(EVENTS.COMMENT_ADDED, params);
}

export function trackReactionAdded(params: { reaction: string; target_type?: string }): void {
  sendEvent(EVENTS.REACTION_ADDED, params);
}
