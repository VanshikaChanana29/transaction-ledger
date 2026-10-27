/**
 * Zero-install local Postgres for development.
 * Downloads a Postgres binary via npm (embedded-postgres) and runs it on port 5434,
 * storing data in .pgdata. Leave it running in its own terminal.
 * Creates two databases: `ledger` (dev) and `ledger_test` (used by `npm test`).
 */
import path from 'node:path';
import fs from 'node:fs';

const dataDir = path.resolve(__dirname, '..', '.pgdata');
const firstRun = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));

async function main() {
  // embedded-postgres is ESM-only, so it's loaded with a dynamic import.
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: 5434,
    persistent: true,
    // On Windows initdb otherwise defaults to WIN1252.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  const shutdown = async () => {
    await pg.stop().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (firstRun) await pg.initialise();
  await pg.start();
  if (firstRun) {
    await pg.createDatabase('ledger');
    await pg.createDatabase('ledger_test');
  }
  console.log('Local Postgres running: postgresql://postgres:postgres@localhost:5434/ledger');
  console.log('Press Ctrl+C to stop.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
