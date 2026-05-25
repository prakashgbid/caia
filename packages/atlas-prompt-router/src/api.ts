/**
 * Framework-agnostic HTTP adapter for the router.
 */

import type {
  AtlasPromptRouter,
  AtlasSubmitPromptResponse,
  RouterErrorDetail,
  RouterErrorKind,
  TicketState,
} from './types.js';
import { RouterError } from './types.js';

export interface ApiHandlerRequest {
  readonly body: unknown;
  readonly params: { readonly ticketId: string };
  readonly operatorUserId: string;
  readonly designVersionId?: string;
  readonly previousState?: TicketState;
}

export interface ApiHandlerErrorBody {
  readonly error: {
    readonly kind: RouterErrorKind | 'internal';
    readonly message: string;
    readonly detail?: RouterErrorDetail;
  };
}

export type ApiHandlerResponse =
  | { readonly status: 200; readonly body: AtlasSubmitPromptResponse }
  | { readonly status: number; readonly body: ApiHandlerErrorBody };

export type AtlasPromptApiHandler = (req: ApiHandlerRequest) => Promise<ApiHandlerResponse>;

const STATUS_BY_KIND: Record<RouterErrorKind, number> = {
  'invalid-body': 400,
  'invalid-prompt': 400,
  'invalid-selection': 400,
  'invalid-ts': 400,
  'invalid-prompt-group-id': 400,
  'body-too-large': 413,
  'unknown-ticket': 404,
  'invalid-transition': 409,
  'dispatcher-failed': 502,
  'classifier-failed': 502,
  'description-writer-failed': 502,
  'persistence-failed': 500,
};

export function statusForKind(kind: RouterErrorKind): number {
  return STATUS_BY_KIND[kind] ?? 500;
}

export function createAtlasPromptApiHandler(router: AtlasPromptRouter): AtlasPromptApiHandler {
  return async function handle(req: ApiHandlerRequest): Promise<ApiHandlerResponse> {
    if (!req || typeof req !== 'object') {
      return errorRes(400, 'invalid-body', 'request envelope is missing');
    }
    const params = req.params;
    if (!params || typeof params !== 'object') {
      return errorRes(400, 'invalid-body', 'params.ticketId is required');
    }
    const ticketId = params.ticketId;
    if (typeof ticketId !== 'string' || ticketId.length === 0) {
      return errorRes(400, 'invalid-body', 'params.ticketId must be a non-empty string', {
        field: 'ticketId',
      });
    }
    const operatorUserId = req.operatorUserId;
    if (typeof operatorUserId !== 'string' || operatorUserId.length === 0) {
      return errorRes(400, 'invalid-body', 'operatorUserId is required', {
        field: 'operatorUserId',
      });
    }
    try {
      const submitInput: {
        ticketId: string;
        operatorUserId: string;
        body: unknown;
        designVersionId?: string;
        previousState?: TicketState;
      } = { ticketId, operatorUserId, body: req.body };
      if (typeof req.designVersionId === 'string' && req.designVersionId.length > 0) {
        submitInput.designVersionId = req.designVersionId;
      }
      if (req.previousState !== undefined) {
        submitInput.previousState = req.previousState;
      }
      const out = await router.submitPrompt(submitInput as Parameters<typeof router.submitPrompt>[0]);
      return { status: 200, body: out };
    } catch (err) {
      if (err instanceof RouterError) {
        return {
          status: statusForKind(err.kind),
          body: { error: { kind: err.kind, message: err.message, detail: err.detail } },
        };
      }
      return {
        status: 500,
        body: {
          error: {
            kind: 'internal',
            message: err instanceof Error ? err.message : 'unknown router error',
          },
        },
      };
    }
  };
}

function errorRes(
  status: number,
  kind: RouterErrorKind,
  message: string,
  detail?: RouterErrorDetail,
): ApiHandlerResponse {
  const body: ApiHandlerErrorBody = detail
    ? { error: { kind, message, detail } }
    : { error: { kind, message } };
  return { status, body };
}
