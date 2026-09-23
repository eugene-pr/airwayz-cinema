import { runner } from "node-pg-migrate";
import pg from "pg";
import { pino } from "pino";
import { createApp } from "./app";
import { config } from "./config";

const MIGRATIONS_DIR = new URL("../../../database/migrations", import.meta.url).pathname;

const logger = pino({ level: config.logLevel });

// Bounded waits (ARCHITECTURE §3.5), set once on the pool.
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 5_000,
  options: "-c lock_timeout=3s -c statement_timeout=10s",
});
// An idle client losing its connection emits here; unhandled, it kills the process.
pool.on("error", (err) => logger.error({ err }, "idle pg client error"));

await runner({
  databaseUrl: config.databaseUrl,
  dir: MIGRATIONS_DIR,
  direction: "up",
  migrationsTable: "pgmigrations",
  advisoryLockMode: "wait",
  logger: logger.child({ component: "migrate" }),
});

const server = createApp({ pool, logger }).listen(config.port, () => {
  logger.info({ port: config.port }, "api listening");
});

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    pool.end().then(() => process.exit(0));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
