import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { pinoHttp } from "pino-http";

export const CORRELATION_HEADER = "x-request-id";

// Request-scoped child logger (req.log) carrying the correlation id, which is
// echoed back to the client so a 5xx can be matched to its log line.
export function requestLogger(logger: Logger) {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers[CORRELATION_HEADER];
      const id = typeof incoming === "string" && incoming.length <= 128 ? incoming : randomUUID();
      res.setHeader(CORRELATION_HEADER, id);
      return id;
    },
  });
}
