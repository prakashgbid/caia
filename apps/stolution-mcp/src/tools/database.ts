import pg from 'pg';

const { Client } = pg;

// ─── Configuration ────────────────────────────────────────────────────────────

function getDbConfig(): pg.ClientConfig {
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME ?? 'stolution',
    user: process.env.DB_USER ?? 's903',
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000, // 15s max query time
  };
}

// ─── Safety: only allow SELECT queries ────────────────────────────────────────

const WRITE_PATTERNS = [
  /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|GRANT|REVOKE|COPY)\b/i,
  /\bpg_terminate_backend\b/i,
  /\bpg_cancel_backend\b/i,
];

export function isReadOnlyQuery(sql: string): boolean {
  return !WRITE_PATTERNS.some(p => p.test(sql.trim()));
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

export async function handleDbQuery(args: Record<string, unknown>): Promise<string> {
  const sql = args.sql as string;
  const params = (args.params as unknown[]) ?? [];

  if (!sql) throw new Error('sql is required');
  if (!isReadOnlyQuery(sql)) {
    throw new Error('Only read-only SELECT queries are allowed. Use stolution_bash for admin tasks.');
  }

  const client = new Client(getDbConfig());
  await client.connect();
  try {
    const result = await client.query(sql, params);
    const { rows, fields } = result;

    if (rows.length === 0) return '(query returned 0 rows)';

    // Format as ASCII table
    const headers = fields.map(f => f.name);
    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map(r => String(r[h] ?? 'NULL').length))
    );
    const separator = colWidths.map(w => '-'.repeat(w + 2)).join('+');
    const header = headers.map((h, i) => ` ${h.padEnd(colWidths[i])} `).join('|');
    const dataRows = rows.map(row =>
      headers.map((h, i) => ` ${String(row[h] ?? 'NULL').padEnd(colWidths[i])} `).join('|')
    );

    const table = [header, separator, ...dataRows].join('\n');
    return `${rows.length} row(s):\n${table}`;
  } finally {
    await client.end();
  }
}

export async function handleDbSchema(args: Record<string, unknown>): Promise<string> {
  const tableName = args.table_name as string;

  const client = new Client(getDbConfig());
  await client.connect();
  try {
    if (tableName) {
      // Get column info for a specific table
      const { rows } = await client.query(
        `SELECT
           column_name,
           data_type,
           character_maximum_length,
           is_nullable,
           column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [tableName]
      );
      if (rows.length === 0) return `Table "${tableName}" not found in public schema.`;

      const lines = rows.map(r =>
        `  ${r.column_name.padEnd(30)} ${r.data_type}${r.character_maximum_length ? `(${r.character_maximum_length})` : ''} ${r.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}${r.column_default ? ` DEFAULT ${r.column_default}` : ''}`
      );

      // Also get indexes
      const { rows: indexes } = await client.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = $1`,
        [tableName]
      );
      const indexLines = indexes.map(i => `  ${i.indexname}: ${i.indexdef}`);

      return `=== Table: ${tableName} ===\n${lines.join('\n')}\n\n=== Indexes ===\n${indexLines.join('\n') || '  (none)'}`;
    } else {
      // List all tables
      const { rows } = await client.query(
        `SELECT table_name, table_type
         FROM information_schema.tables
         WHERE table_schema = 'public'
         ORDER BY table_type, table_name`
      );
      const lines = rows.map(r => `  ${r.table_name.padEnd(40)} ${r.table_type}`);
      return `=== Tables in public schema ===\n${lines.join('\n')}`;
    }
  } finally {
    await client.end();
  }
}

// ─── Tool Definitions ─────────────────────────────────────────────────────────

export const databaseToolDefs = [
  {
    name: 'stolution_db_query',
    description: [
      'Run a read-only SELECT query against the stolution PostgreSQL database.',
      'Only SELECT statements are allowed — INSERT/UPDATE/DELETE/DROP are rejected.',
      'Results formatted as an ASCII table. Max 15s query time.',
      'Requires DB_HOST, DB_NAME, DB_USER, DB_PASSWORD environment variables on the server.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT SQL query to execute' },
        params: {
          type: 'array',
          items: {},
          description: 'Optional parameterized query values (for $1, $2, … placeholders)',
          default: [],
        },
      },
      required: ['sql'],
    },
  },
  {
    name: 'stolution_db_schema',
    description: 'Inspect the stolution PostgreSQL schema. If table_name is given, returns columns and indexes for that table. Otherwise lists all tables.',
    inputSchema: {
      type: 'object',
      properties: {
        table_name: {
          type: 'string',
          description: 'Table name to inspect. Omit to list all tables.',
        },
      },
    },
  },
];
