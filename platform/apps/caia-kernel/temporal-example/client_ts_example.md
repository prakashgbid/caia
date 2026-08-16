# TypeScript starter (reference) — @temporalio/client

```ts
import { Client, Connection } from '@temporalio/client';
import { randomUUID } from 'node:crypto';

async function main(): Promise<void> {
  const connection = await Connection.connect({ address: '127.0.0.1:7233' });
  const client = new Client({ connection, namespace: 'caia' });
  const handle = await client.workflow.start('GreetingWorkflow', {
    taskQueue: 'caia.factories.default',
    args: ['CAIA Kernel (TS)'],
    workflowId: `caia-kernel-smoke-${randomUUID().slice(0, 8)}`,
  });
  console.log(`Started workflow id=${handle.workflowId}`);
  const result = await handle.result();
  console.log(`Result: ${result}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Install: `npm i @temporalio/client`
