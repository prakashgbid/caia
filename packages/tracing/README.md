# @chiefaia/tracing

OpenTelemetry-compatible distributed tracing for CAIA applications.

## Install

```bash
pnpm add @chiefaia/tracing
```

## Usage

```ts
import { createTracer } from '@chiefaia/tracing';

const tracer = createTracer('my-service');

const result = await tracer.withSpan('process-order', async (span) => {
  span.setAttribute('order.id', orderId);
  const order = await db.fetchOrder(orderId);
  span.setAttribute('order.total', order.total);
  return order;
});
```
