import type { HealthResponse } from "@cinema/contracts";
import { Router } from "express";
import type pg from "pg";

// Ops, not a module: no tables, no rules, so no service/repository (ARCHITECTURE §10).
export function healthRouter(pool: pg.Pool) {
  const router = Router();
  router.get("/api/health", async (_req, res) => {
    const { rows } = await pool.query<{ server_time: Date }>("SELECT now() AS server_time");
    const [row] = rows;
    if (!row) throw new Error("SELECT now() returned no row");
    const body: HealthResponse = { ok: true, serverTime: row.server_time.toISOString() };
    res.json(body);
  });
  return router;
}
