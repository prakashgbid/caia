/**
 * Dead-letter handling.
 *
 * V1 wires the hook point but does NOT route poison messages to
 * a DLQ stream. The handler subscribes to JetStream advisory
 * subjects (`$JS.EVENT.ADVISORY.CONSUMER.MAX_DELIVERIES.>`) and
 * logs; v0.2 will republish into a `chiefaia-events-dlq` stream
 * and emit an audit event.
 *
 * Per spec §4.2 / §4.7.
 */

export interface DlqAdvisory {
  stream: string;
  consumer: string;
  deliveries: number;
  reason: string;
  rawSubject: string;
  rawPayload: Uint8Array;
}

export type DlqHandler = (advisory: DlqAdvisory) => void | Promise<void>;

/** Default handler — logs and drops. Replace in v0.2. */
export const defaultDlqHandler: DlqHandler = (advisory) => {
  // Intentionally noisy; operator should grep for this.
  // eslint-disable-next-line no-console
  console.warn(
    `[event-bus-nats] DLQ advisory: stream=${advisory.stream} consumer=${advisory.consumer} deliveries=${advisory.deliveries} reason=${advisory.reason}`,
  );
};
