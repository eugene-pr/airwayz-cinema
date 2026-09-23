import { runner } from "node-pg-migrate";
import type { Logger } from "pino";

const MIGRATIONS_DIR = new URL("../../../database/migrations", import.meta.url).pathname;

// Used by boot (main.ts) and by integration tests against db-test.
export async function migrate(databaseUrl: string, logger: Logger) {
  await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction: "up",
    migrationsTable: "pgmigrations",
    advisoryLockMode: "wait",
    logger: logger.child({ component: "migrate" }),
  });
}
