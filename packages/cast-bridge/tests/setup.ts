import { vi } from 'vitest';

// Mock BroadcastChannel for unit tests
class MockBroadcastChannel {
  name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private static channels = new Map<string, MockBroadcastChannel[]>();

  constructor(name: string) {
    this.name = name;
    if (!MockBroadcastChannel.channels.has(name)) {
      MockBroadcastChannel.channels.set(name, []);
    }
    MockBroadcastChannel.channels.get(name)!.push(this);
  }

  postMessage(data: unknown) {
    const channels = MockBroadcastChannel.channels.get(this.name) ?? [];
    channels.forEach((ch) => {
      if (ch !== this && ch.onmessage) {
        ch.onmessage(new MessageEvent('message', { data }));
      }
    });
  }

  close() {
    const channels = MockBroadcastChannel.channels.get(this.name) ?? [];
    const idx = channels.indexOf(this);
    if (idx !== -1) channels.splice(idx, 1);
  }

  static reset() {
    MockBroadcastChannel.channels.clear();
  }
}

vi.stubGlobal('BroadcastChannel', MockBroadcastChannel);
