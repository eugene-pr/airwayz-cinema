import express from "express";
import type pg from "pg";
import type { Logger } from "pino";
import { healthRouter } from "./health";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/request-logger";

export interface AppDeps {
  pool: pg.Pool;
  logger: Logger;
}

// Composition root: every dependency is wired here, by hand.
export function createApp({ pool, logger }: AppDeps) {
  const app = express();
  app.use(requestLogger(logger));
  app.use(express.json());

  app.use(healthRouter(pool));

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}
