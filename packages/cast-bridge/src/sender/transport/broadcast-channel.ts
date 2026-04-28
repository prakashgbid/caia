import type { CastMessage, Transport } from '../../filters/types';

export class BroadcastChannelTransport implements Transport {
  private channel: BroadcastChannel;
  private handlers: Array<(msg: CastMessage) => void> = [];

  constructor(roomId: string) {
    this.channel = new BroadcastChannel(`cast-${roomId}`);
    this.channel.onmessage = (event: MessageEvent<CastMessage>) => {
      this.handlers.forEach((h) => h(event.data));
    };
  }

  send(message: CastMessage): void {
    this.channel.postMessage(message);
  }

  onMessage(handler: (message: CastMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  close(): void {
    this.channel.close();
    this.handlers = [];
  }
}
