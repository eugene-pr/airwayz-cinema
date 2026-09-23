import cookieParser from "cookie-parser";
import express from "express";
import type pg from "pg";
import type { Logger } from "pino";
import { healthRouter } from "./health";
import { authenticate } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error-handler";
import { requestLogger } from "./middleware/request-logger";
import { authRouter, createAuthService } from "./modules/auth";

export interface AppDeps {
  pool: pg.Pool;
  logger: Logger;
  jwtSecret: string;
}

// Composition root: every dependency is wired here, by hand.
export function createApp({ pool, logger, jwtSecret }: AppDeps) {
  const auth = createAuthService({ pool, jwtSecret });
  const requireActor = authenticate(auth);

  const app = express();
  app.use(requestLogger(logger));
  app.use(express.json());
  app.use(cookieParser());

  app.use(healthRouter(pool));
  app.use(authRouter(auth, requireActor));

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}
