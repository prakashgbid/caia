/**
 * Tests for @chiefaia/sql-helper. Uses a mock A2A server (Hono) on a
 * random port so we exercise the full A2AClient round-trip without
 * needing the real XiYanSQL endpoint.
 *
 * This is the M0/M1 verification proof that:
 *   1. The MESH_SQL=on flag actually routes through the A2A adapter
 *   2. The XiYanSQL response shape is correctly parsed
 *   3. Provenance fields make it back into the result
 *
 * Run via: `pnpm --filter @chiefaia/sql-helper test`
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { composeSql, meshSqlHealth } from '../src/index.js';

function startMockA2A(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/a2a/agent-card.json' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            schemaVersion: '1.0',
            agentId: 'xiyansql-mock',
            name: 'XiYanSQL Mock',
            description: 'mock for tests',
            url: `http://127.0.0.1`,
            provider: { kind: 'local', model: 'xiyansql-mock', license: 'apache-2.0' },
            skills: [{ id: 'sql.compose', name: 'NL→SQL', description: 'mock' }],
          }),
        );
        return;
      }
      if (req.url === '/a2a' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                status: 'done',
                artifact: {
                  artifactId: body.params.taskId + '::sql',
                  kind: 'sql',
                  body: {
                    sql: 'SELECT 1 AS mock;',
                    rationale: 'mock for test',
                  },
                  producerModel: 'XiYanSQL-QwenCoder-32B-2504-MOCK',
                  producerVersion: 'mock-0.1',
                  caiaChainRunId: body.params.contextId,
                  caiaPhaseStepId: 'sql.compose',
                  createdAt: new Date().toISOString(),
                },
              },
            }),
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

test('composeSql routes through A2A when MESH_SQL=on', async () => {
  const { server, port } = await startMockA2A();
  try {
    process.env.MESH_SQL = 'on';
    process.env.XIYAN_SQL_URL = `http://127.0.0.1:${port}`;
    const r = await composeSql({
      task: 'select one',
      schemaSql: '-- mock schema',
      caiaChainRunId: 'test-chain-1',
      caiaPhaseStepId: 'sql.compose',
    });
    assert.equal(r.sql, 'SELECT 1 AS mock;');
    assert.equal(r.producerModel, 'XiYanSQL-QwenCoder-32B-2504-MOCK');
    assert.equal(r.artifactId, 'test-chain-1::sql.compose::sql');
    assert.ok(r.rationale.includes('mock'));
  } finally {
    server.close();
    delete process.env.MESH_SQL;
    delete process.env.XIYAN_SQL_URL;
  }
});

test('composeSql throws helpful error when MESH_SQL=off', async () => {
  delete process.env.MESH_SQL;
  await assert.rejects(
    () => composeSql({ task: 'x', schemaSql: 'y' }),
    /MESH_SQL is off/,
  );
});

test('meshSqlHealth returns reachable=false when MESH_SQL=off', async () => {
  delete process.env.MESH_SQL;
  const h = await meshSqlHealth();
  assert.equal(h.meshOn, false);
  assert.equal(h.reachable, false);
});

test('meshSqlHealth returns reachable=true against mock', async () => {
  const { server, port } = await startMockA2A();
  try {
    process.env.MESH_SQL = 'on';
    process.env.XIYAN_SQL_URL = `http://127.0.0.1:${port}`;
    const h = await meshSqlHealth();
    assert.equal(h.meshOn, true);
    assert.equal(h.reachable, true);
  } finally {
    server.close();
    delete process.env.MESH_SQL;
    delete process.env.XIYAN_SQL_URL;
  }
});
