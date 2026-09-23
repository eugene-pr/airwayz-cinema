import {
  type ReservationResponse,
  reservationParams,
  type SeatingMapResponse,
  type SelectionRequest,
  selectionRequest,
} from "@cinema/contracts";
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

  router.post("/api/reservations", requireActor, async (req, res) => {
    const { seatIds }: SelectionRequest = selectionRequest.parse(req.body);
    const body: ReservationResponse = await cinema.createReservation(actorOf(req), seatIds);
    res.status(201).json(body);
  });

  router.put("/api/reservations/:id/seats", requireActor, async (req, res) => {
    const { id } = reservationParams.parse(req.params);
    const { seatIds }: SelectionRequest = selectionRequest.parse(req.body);
    const body: ReservationResponse = await cinema.replaceReservationSeats(actorOf(req), id, seatIds);
    res.json(body);
  });

  return router;
}
