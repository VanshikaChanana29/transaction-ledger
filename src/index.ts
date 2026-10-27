import { env } from './config/env';
import { createApp } from './app';
import { prisma } from './lib/prisma';

async function main() {
  await prisma.$connect();
  const server = createApp().listen(env.PORT, () => {
    console.log(`Transaction Ledger API listening on http://localhost:${env.PORT} (docs: /api/docs)`);
  });

  const shutdown = () => {
    server.close(() => prisma.$disconnect().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
