import type { SeatingMapResponse } from "@cinema/contracts";
import { type RequestHandler, Router } from "express";
import { actorOf } from "../../middleware/auth";
import type { CinemaService } from "./service";

export function cinemaRouter(cinema: CinemaService, requireActor: RequestHandler) {
  const router = Router();

  // Identical for every viewer (ARCHITECTURE §10), but a login is still required.
  router.get("/api/seats", requireActor, async (req, res) => {
    const body: SeatingMapResponse = await cinema.getSeatingMap(actorOf(req));
    res.json(body);
  });

  return router;
}
