#!/usr/bin/env tsx
/**
 * chiefaia-sql-helper CLI — author a SQL query from natural language via the
 * P5 mesh. Per operator's "actually using it" rule, this is the user-facing
 * way to invoke @chiefaia/sql-helper without writing TS.
 *
 * Usage:
 *   MESH_SQL=on chiefaia-sql-helper --task "top 10 affiliates by revenue last 30d" \
 *     --schema-file schema.sql --dialect postgres
 *
 *   chiefaia-sql-helper --health     # check whether the mesh is reachable
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { composeSql, meshSqlHealth } from './index.js';

async function main(): Promise<number> {
  const { values } = parseArgs({
    allowPositionals: false,
    options: {
      task: { type: 'string' },
      'schema-file': { type: 'string' },
      schema: { type: 'string' },
      dialect: { type: 'string' },
      'chain-run-id': { type: 'string' },
      'phase-step-id': { type: 'string' },
      health: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    console.log(`chiefaia-sql-helper — NL→SQL via the P5 mesh

Options:
  --task <str>           Natural-language description of the desired query
  --schema-file <path>   Path to a .sql file containing the relevant DDL
  --schema <str>         Inline DDL (alternative to --schema-file)
  --dialect <s>          postgres|mysql|sqlite (default postgres)
  --chain-run-id <id>    CAIA chain run id for provenance
  --phase-step-id <id>   CAIA phase step id for provenance
  --health               Check whether the mesh SQL endpoint is reachable
  -h, --help             Show this message

Env:
  MESH_SQL=on            Required — enables the mesh dispatch path
  XIYAN_SQL_URL          Override the XiYanSQL endpoint (default http://127.0.0.1:8410)
`);
    return 0;
  }

  if (values.health) {
    const h = await meshSqlHealth();
    console.log(JSON.stringify(h, null, 2));
    return h.reachable ? 0 : 1;
  }

  if (!values.task) {
    console.error('--task is required (use --help)');
    return 2;
  }
  let schemaSql = values.schema ?? '';
  if (values['schema-file']) {
    schemaSql = await readFile(values['schema-file'], 'utf8');
  }
  if (!schemaSql) {
    console.error('Either --schema or --schema-file is required');
    return 2;
  }

  const result = await composeSql({
    task: values.task,
    schemaSql,
    dialect: (values.dialect as 'postgres' | 'mysql' | 'sqlite' | undefined) ?? 'postgres',
    caiaChainRunId: values['chain-run-id'],
    caiaPhaseStepId: values['phase-step-id'],
  });

  console.log('-- producer:', result.producerModel);
  console.log('-- artifact:', result.artifactId);
  if (result.rationale) console.log('-- rationale:', result.rationale);
  console.log(result.sql);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('error:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
