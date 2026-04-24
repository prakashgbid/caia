# @chiefaia/events

Typed in-process event bus for CAIA applications.

## Install

```bash
pnpm add @chiefaia/events
```

## Usage

```ts
import { createEventBus } from '@chiefaia/events';

const bus = createEventBus();

const unsub = bus.on<{ userId: string }>('user.created', async ({ userId }) => {
  console.log('new user:', userId);
});

await bus.emit('user.created', { userId: 'u-123' });

// One-shot listener
const payload = await bus.once<{ userId: string }>('user.created');
```
