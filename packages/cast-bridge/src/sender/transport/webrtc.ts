import type { CastMessage, Transport } from '../../filters/types';

export class WebRTCTransport implements Transport {
  constructor(_roomId: string) {
    throw new Error(
      'WebRTC transport is not implemented in v1. Use BroadcastChannel instead.'
    );
  }

  send(_message: CastMessage): void {
    throw new Error('Not implemented in v1');
  }

  onMessage(_handler: (message: CastMessage) => void): () => void {
    throw new Error('Not implemented in v1');
  }

  close(): void {
    throw new Error('Not implemented in v1');
  }
}
