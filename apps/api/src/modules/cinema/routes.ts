import {
  type ReservationListResponse,
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

  router.get("/api/reservations", requireActor, async (req, res) => {
    const body: ReservationListResponse = await cinema.listReservations(actorOf(req));
    res.json(body);
  });

  router.post("/api/reservations/:id/complete", requireActor, async (req, res) => {
    const { id } = reservationParams.parse(req.params);
    const body: ReservationResponse = await cinema.completeReservation(actorOf(req), id);
    res.json(body);
  });

  router.delete("/api/reservations/:id", requireActor, async (req, res) => {
    const { id } = reservationParams.parse(req.params);
    await cinema.cancelReservation(actorOf(req), id);
    res.status(204).end();
  });

  return router;
}
