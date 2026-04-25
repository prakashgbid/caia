import type { Transport } from '../../filters/types';
import { BroadcastChannelTransport } from './broadcast-channel';
import { WebRTCTransport } from './webrtc';

export type TransportType = 'broadcast-channel' | 'webrtc';

export function createTransport(type: TransportType, roomId: string): Transport {
  if (type === 'broadcast-channel') {
    return new BroadcastChannelTransport(roomId);
  }
  if (type === 'webrtc') {
    return new WebRTCTransport(roomId);
  }
  throw new Error(`Unknown transport type: ${String(type)}`);
}

export type { Transport };
