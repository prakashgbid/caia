import { EVENTS } from "./taxonomy";
import { sendEvent } from "../integrations/ga4";

export interface LessonParams {
  lesson_id: string;
  lesson_title?: string;
  category?: string;
}

export interface ArticleParams {
  article_id: string;
  title?: string;
  category?: string;
  scroll_pct?: number;
}

export function trackLessonStarted(params: LessonParams): void {
  sendEvent(EVENTS.LESSON_STARTED, params);
}

export function trackLessonCompleted(params: LessonParams): void {
  sendEvent(EVENTS.LESSON_COMPLETED, params);
}

export function trackArticleRead(params: ArticleParams): void {
  sendEvent(EVENTS.ARTICLE_READ, params);
}

export function trackPaperRead(params: ArticleParams): void {
  sendEvent(EVENTS.PAPER_READ, params);
}

export function trackVideoPlayed(params: { video_id: string; title?: string; duration_sec?: number }): void {
  sendEvent(EVENTS.VIDEO_PLAYED, params);
}
