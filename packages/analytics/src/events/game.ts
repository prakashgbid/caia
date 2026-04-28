import { EVENTS } from "./taxonomy";
import { sendEvent } from "../integrations/ga4";

export interface GameStartParams {
  variant: string;
  difficulty?: string;
  app_name?: string;
}

export interface GameEndParams {
  variant: string;
  outcome: "win" | "loss" | "neutral";
  net_profit?: number;
  duration_sec?: number;
  hands_played?: number;
}

export interface BetPlacedParams {
  amount: number;
  bet_type: string;
  variant?: string;
  chip_value?: number;
}

export interface ActionTakenParams {
  action: string;
  position?: string;
  pot_size?: number;
  street?: string;
}

export function trackGameStart(params: GameStartParams): void {
  sendEvent(EVENTS.GAME_START, params);
}

export function trackGameEnd(params: GameEndParams): void {
  sendEvent(EVENTS.GAME_END, params);
  if (params.outcome === "win") sendEvent(EVENTS.WIN, { net_profit: params.net_profit, variant: params.variant });
  if (params.outcome === "loss") sendEvent(EVENTS.LOSS, { net_profit: params.net_profit, variant: params.variant });
}

export function trackBetPlaced(params: BetPlacedParams): void {
  sendEvent(EVENTS.BET_PLACED, params);
}

export function trackActionTaken(params: ActionTakenParams): void {
  sendEvent(EVENTS.ACTION_TAKEN, params);
}

export function trackVariantChanged(from: string, to: string): void {
  sendEvent(EVENTS.VARIANT_CHANGED, { from, to });
}

export function trackDifficultySelected(difficulty: string): void {
  sendEvent(EVENTS.DIFFICULTY_SELECTED, { difficulty });
}
