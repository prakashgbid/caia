#!/usr/bin/env node
// Smoke script: index a directory and run a query against the built dist.
// Run after `pnpm --filter @chiefaia/local-rag build`.
//
// Usage:
//   ROOT=./packages QUERY="how does the router decide local vs claude" \
//     node packages/local-rag/scripts/smoke.js

'use strict';

const path = require('node:path');

async function main() {
  const distPath = path.join(__dirname, '..', 'dist', 'index.js');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LocalRag } = require(distPath);

  const root = process.env.ROOT || process.argv[2] || './packages';
  const query =
    process.env.QUERY ||
    process.argv[3] ||
    'how does the router decide local vs claude';
  const dbPath = process.env.DB || '.local-rag.db';

  const rag = new LocalRag({ dbPath });

  // eslint-disable-next-line no-console
  console.log(`[local-rag] indexing ${root} -> ${dbPath}`);
  let lastEmbed = 0;
  const result = await rag.indexDirectory(root, {}, (event) => {
    if (event.kind === 'files') {
      // eslint-disable-next-line no-console
      console.log(`  files=${event.files}`);
    } else if (event.kind === 'chunks') {
      // eslint-disable-next-line no-console
      console.log(`  chunks=${event.chunks}, embedding...`);
    } else if (event.kind === 'embed' && event.done - lastEmbed >= 50) {
      lastEmbed = event.done;
      // eslint-disable-next-line no-console
      console.log(`  embed ${event.done}/${event.total}`);
    }
  });
  // eslint-disable-next-line no-console
  console.log(`[local-rag] indexed ${result.chunks} chunks`);

  // eslint-disable-next-line no-console
  console.log(`\n[local-rag] query: ${JSON.stringify(query)}`);
  const hits = await rag.query(query, { topK: 5, minScore: 0.2 });
  for (const hit of hits) {
    const snippet = hit.chunk.content.split('\n').slice(0, 4).join('\n');
    // eslint-disable-next-line no-console
    console.log(
      `\n  [${hit.score.toFixed(3)}] ${hit.chunk.path}:` +
        `${hit.chunk.startLine}-${hit.chunk.endLine}\n` +
        snippet.replace(/^/gm, '    '),
    );
  }
  rag.close();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
