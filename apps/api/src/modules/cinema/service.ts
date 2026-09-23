import type { SeatingMapResponse, SeatStatus } from "@cinema/contracts";
import type pg from "pg";
import type { Actor } from "../auth";
import { createCinemaRepository } from "./repository";
import type { SeatWithReservation } from "./types";

export interface CinemaServiceDeps {
  pool: pg.Pool;
}

export function createCinemaService({ pool }: CinemaServiceDeps) {
  const repository = createCinemaRepository(pool);

  return {
    // Identical for every viewer — ownership is joined client-side (ARCHITECTURE §10) — so
    // the actor authorizes nothing here; it's taken for the uniform service signature.
    async getSeatingMap(_actor: Actor): Promise<SeatingMapResponse> {
      const { checkedAt, seats } = await repository.listSeats();
      return {
        items: seats.map((seat) => ({
          id: seat.id,
          code: `${seat.rowLabel}${seat.seatNumber}`,
          rowLabel: seat.rowLabel,
          seatNumber: seat.seatNumber,
          status: deriveSeatStatus(seat, checkedAt),
        })),
      };
    },
  };
}
export type CinemaService = ReturnType<typeof createCinemaService>;

// ARCHITECTURE §6's derivation table. A completed reservation never consults its deadline.
function deriveSeatStatus({ reservation }: SeatWithReservation, checkedAt: Date): SeatStatus {
  if (reservation?.status === "completed") return "booked";
  if (reservation?.status === "held" && reservation.expiresAt > checkedAt) return "reserved";
  return "available";
}
