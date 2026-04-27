import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

import type { NotificationChannel, NotificationKind } from '../requirements/types';

export interface PendingNotification {
  id: string;
  requirementId: string;
  kind: NotificationKind;
  message: string;
  channel: NotificationChannel;
  ts: string;
}

export class NotificationQueue {
  private queue: PendingNotification[] = [];
  private readonly logPath: string;

  constructor(conductorDir?: string) {
    const dir = conductorDir ?? path.join(os.homedir(), '.conductor');
    this.logPath = path.join(dir, 'notifications.log');
  }

  enqueue(
    requirementId: string,
    kind: NotificationKind,
    message: string,
    channel: NotificationChannel = 'both',
  ): PendingNotification {
    const notif: PendingNotification = {
      id: 'notif_' + nanoid(8),
      requirementId,
      kind,
      message,
      channel,
      ts: new Date().toISOString(),
    };
    this.queue.push(notif);

    if (channel === 'native' || channel === 'both') {
      this.sendNative(message, kind);
    }

    return notif;
  }

  drain(): PendingNotification[] {
    const pending = [...this.queue];
    this.queue = [];
    return pending;
  }

  pendingCount(): number {
    return this.queue.length;
  }

  private sendNative(message: string, subtitle: string): void {
    try {
      const safeMsg = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const safeSub = subtitle.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execSync(
        `osascript -e 'display notification "${safeMsg}" with title "Conductor" subtitle "${safeSub}"'`,
        { timeout: 3000, stdio: 'ignore' },
      );
    } catch {
      this.log(`NOTIFY [${subtitle}]: ${message}`);
    }
  }

  private log(text: string): void {
    try {
      fs.appendFileSync(this.logPath, `[${new Date().toISOString()}] ${text}\n`);
    } catch {
      // best-effort log
    }
  }
}

// Module-level singleton so MCP server and pump share the same queue instance.
let _globalQueue: NotificationQueue | null = null;

export function getNotificationQueue(conductorDir?: string): NotificationQueue {
  if (!_globalQueue) {
    _globalQueue = new NotificationQueue(conductorDir);
  }
  return _globalQueue;
}

export function resetNotificationQueue(): void {
  _globalQueue = null;
}
