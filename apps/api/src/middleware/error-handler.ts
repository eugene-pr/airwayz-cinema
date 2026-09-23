import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, badRequest, notFound } from "./app-error";

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound());

// Central error middleware. 4xx carry their own message; anything else is a
// 5xx whose message and stack stay in the log, keyed by the correlation id.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = toAppError(err);
  if (known) {
    const { code, message, details } = known;
    // A 4xx with a cause is a server-side signal too, e.g. a lock-wait timeout (ARCHITECTURE §3.5).
    if (known.cause) req.log.warn({ err: known.cause }, message);
    res.status(known.status).json({ error: details ? { code, message, details } : { code, message } });
    return;
  }
  req.log.error({ err }, "unhandled error");
  res.status(500).json({ error: { code: "INTERNAL", message: "Internal server error" } });
};

// Only client errors pass through; a 5xx AppError is sanitized like any other.
function toAppError(err: unknown): AppError | undefined {
  if (err instanceof AppError) return err.status < 500 ? err : undefined;
  if (err instanceof ZodError) return badRequest("Invalid request", { issues: err.issues });
  // body-parser: malformed JSON, oversized body, etc.
  if (isClientHttpError(err)) return badRequest(err.expose ? err.message : "Bad request");
  return undefined;
}

function isClientHttpError(err: unknown): err is { status: number; expose?: boolean; message: string } {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}
