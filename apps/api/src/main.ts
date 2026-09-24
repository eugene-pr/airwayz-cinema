import pg from "pg";
import { pino } from "pino";
import { seedDev } from "../../../database/seeds/dev";
import { createApp } from "./app";
import { config } from "./config";
import { migrate } from "./migrate";

// The JWT rides in the cookie header; it never reaches the log.
const logger = pino({
  level: config.logLevel,
  redact: ["req.headers.cookie", 'res.headers["set-cookie"]'],
});

// Bounded waits (ARCHITECTURE §3.5), set once on the pool.
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 5_000,
  options: "-c lock_timeout=3s -c statement_timeout=10s",
});
// An idle client losing its connection emits here; unhandled, it kills the process.
pool.on("error", (err) => logger.error({ err }, "idle pg client error"));

await migrate(config.databaseUrl, logger);
// Dev users + seating map, so `docker compose up` alone is usable (ARCHITECTURE §2 #28).
logger.info({ inserted: await seedDev(pool) }, "seeded");

const server = createApp({ pool, logger, jwtSecret: config.jwtSecret }).listen(config.port, () => {
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
