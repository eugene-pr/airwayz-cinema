import type {
  ReservationListResponse,
  ReservationResponse,
  SeatingMapResponse,
  SeatStatus,
} from "@cinema/contracts";
import { validateRule1, validateSelection } from "@cinema/seat-rules";
import type pg from "pg";
import { badRequest, conflict, notFound } from "../../middleware/app-error";
import type { Actor } from "../auth";
import { type CinemaRepository, createCinemaRepository } from "./repository";
import type { SeatWithReservation, StoredReservation } from "./types";

export interface CinemaServiceDeps {
  pool: pg.Pool;
}

const RESERVATION_LIFETIME_MS = 15 * 60_000;

// The three conflict codes (ARCHITECTURE §3.3).
const seatsUnavailable = (details?: { seatIds: string[] }) =>
  conflict("SEATS_UNAVAILABLE", "One or more selected seats are no longer available", details);
// Same code: in a race, the seats the other request got are what make this selection isolate a seat.
const isolatedSeat = () =>
  conflict("SEATS_UNAVAILABLE", "This selection would leave a single empty seat between occupied ones", {
    rule: 2,
  });
const reservationNotHeld = () =>
  conflict(
    "RESERVATION_NOT_HELD",
    "This reservation is no longer held — it expired, was cancelled, or is already complete",
  );
const reservationAlreadyHeld = () =>
  conflict("RESERVATION_ALREADY_HELD", "You already have a held reservation — change its seats instead");

// §3.5: lock_timeout and statement_timeout. Someone else holds the lock; the remedy is the usual one.
// A pool-acquire timeout isn't among them: a saturated server, not a moved seat, so a 500 (§2 #33).
const LOCK_WAIT_EXCEEDED = new Set(["55P03", "57014"]);

// No details: the request never got far enough to learn which seat moved (§3.3).
function orSeatsUnavailable(err: unknown) {
  const { code } = (err ?? {}) as { code?: unknown };
  return typeof code === "string" && LOCK_WAIT_EXCEEDED.has(code)
    ? Object.assign(seatsUnavailable(), { cause: err })
    : err;
}

export function createCinemaService({ pool }: CinemaServiceDeps) {
  const repository = createCinemaRepository(pool);

  // READ COMMITTED; the advisory locks taken inside are released by COMMIT or ROLLBACK.
  async function inTransaction<T>(work: (tx: CinemaRepository) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      const result = await work(createCinemaRepository(client));
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw orSeatsUnavailable(err);
    } finally {
      client.release();
    }
  }

  // Seats never change after seed, so their rows are read before any lock is taken.
  // Inside the transaction, so pool.connect() is the write path's only pool wait — a 500 when it times out (§2 #33).
  async function rowsOf(tx: CinemaRepository, seatIds: readonly string[]): Promise<number[]> {
    // The service also serves callers that bypass the route's selectionRequest schema.
    if (seatIds.length === 0) throw badRequest("Select at least one seat");
    const found = await tx.findSeatRows(seatIds);
    if (found.length !== new Set(seatIds).size) throw badRequest("Unknown seat id");
    return found.map((seat) => seat.rowNumber);
  }

  // §3.1 after the user lock: seat rows in ascending order, then checked_at, then reclamation.
  async function lockRowsAndReclaim(tx: CinemaRepository, rowNumbers: number[]): Promise<Date> {
    const sorted = [...new Set(rowNumbers)].sort((a, b) => a - b);
    for (const rowNumber of sorted) await tx.lockRow(rowNumber);
    const checkedAt = await tx.checkedAt();
    await tx.reclaimExpired(sorted, checkedAt);
    return checkedAt;
  }

  // Re-run @cinema/seat-rules on state read under the locks; nothing from the client is trusted.
  // The actor's own seats count as free, so a replacement may overlap them.
  async function validate(
    tx: CinemaRepository,
    rowNumbers: number[],
    seatIds: readonly string[],
    ownReservationId?: string,
  ) {
    const seats = (await tx.listRowSeats(rowNumbers)).map((seat) => ({
      id: seat.id,
      rowNumber: seat.rowNumber,
      seatNumber: seat.seatNumber,
      // After reclamation, every claim left in a locked row is live.
      occupied: seat.reservationId !== undefined && seat.reservationId !== ownReservationId,
    }));
    if (validateRule1(seats, seatIds)) {
      throw badRequest("Seats must be consecutive and in one row", { rule: 1 });
    }
    const occupied = [...new Set(seatIds)].filter((id) => seats.find((seat) => seat.id === id)?.occupied);
    if (occupied.length > 0) throw seatsUnavailable({ seatIds: occupied });

    // Rule 1 already passed above, so any violation left is Rule 2.
    const violation = validateSelection(seats, seatIds);
    // The isolated seat isn't one the client asked for, so `details` names the rule, not seats (§3.3).
    if (violation) throw isolatedSeat();
  }

  // §3.1 user lock, then the owner check. Someone else's reservation doesn't exist, as far as
  // the actor can tell (§10).
  async function lockOwned(tx: CinemaRepository, actor: Actor, reservationId: string) {
    await tx.lockUser(actor.userId);
    const target = await tx.findReservation(reservationId);
    if (target?.userId !== actor.userId) throw notFound();
    return target;
  }

  // Row locks, checked_at, reclamation, then a re-read: reclamation may just have cancelled it,
  // including when its deadline passed while this transaction waited on a lock (§4).
  async function lockHeld(tx: CinemaRepository, target: StoredReservation, extraRows: number[] = []) {
    const checkedAt = await lockRowsAndReclaim(tx, [...extraRows, ...rowOf(target)]);
    const current = await tx.findReservation(target.id);
    // Reclamation already cancels an expired hold; the deadline check states §4's rule outright.
    if (current?.status !== "held" || current.expiresAt <= checkedAt) throw reservationNotHeld();
  }

  async function readBack(tx: CinemaRepository, id: string): Promise<ReservationResponse> {
    const reservation = await tx.findReservation(id);
    if (!reservation) throw new Error(`reservation ${id} vanished inside its own transaction`);
    return toResponse(reservation);
  }

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

    async createReservation(actor: Actor, seatIds: readonly string[]): Promise<ReservationResponse> {
      return inTransaction(async (tx) => {
        const requestedRows = await rowsOf(tx, seatIds);
        await tx.lockUser(actor.userId);
        // Possibly expired. Its row is stable under the user lock: only this user moves its seats.
        const previous = await tx.findHeldReservationOf(actor.userId);
        const checkedAt = await lockRowsAndReclaim(tx, [...requestedRows, ...rowOf(previous)]);

        // Still held after reclamation of its row ⇒ unexpired.
        const current = await tx.findHeldReservationOf(actor.userId);
        if (current) {
          // A retry whose response was lost gets the reservation it already made (§2 #31).
          if (sameSeats(current.seatIds, seatIds)) return toResponse(current);
          throw reservationAlreadyHeld();
        }

        await validate(tx, requestedRows, seatIds);
        const id = await tx.insertReservation(
          actor.userId,
          new Date(checkedAt.getTime() + RESERVATION_LIFETIME_MS),
        );
        await tx.claimSeats(id, seatIds);
        return readBack(tx, id);
      });
    },

    // Keeps the deadline (§4). Failure rolls back everything, previous seats included (§3.4).
    async replaceReservationSeats(
      actor: Actor,
      reservationId: string,
      seatIds: readonly string[],
    ): Promise<ReservationResponse> {
      return inTransaction(async (tx) => {
        const requestedRows = await rowsOf(tx, seatIds);
        const target = await lockOwned(tx, actor, reservationId);
        await lockHeld(tx, target, requestedRows);

        await validate(tx, requestedRows, seatIds, reservationId);
        await tx.releaseSeats(reservationId);
        await tx.claimSeats(reservationId, seatIds);
        return readBack(tx, reservationId);
      });
    },

    // Idempotent for the owner (§4): the hold id is the key, so a retry after a lost response
    // gets the same completed reservation back, with no write.
    async completeReservation(actor: Actor, reservationId: string): Promise<ReservationResponse> {
      return inTransaction(async (tx) => {
        const target = await lockOwned(tx, actor, reservationId);
        // Completed is final — nothing moves a hold out of it — so no row lock is needed to trust it.
        if (target.status === "completed") return toResponse(target);
        await lockHeld(tx, target);
        await tx.completeReservation(reservationId);
        return readBack(tx, reservationId);
      });
    },

    // Releases only this reservation's claims, so a later holder's seats are never touched (§4).
    async cancelReservation(actor: Actor, reservationId: string): Promise<void> {
      await inTransaction(async (tx) => {
        const target = await lockOwned(tx, actor, reservationId);
        await lockHeld(tx, target);
        await tx.cancelReservation(reservationId);
      });
    },

    // The actor's own only; the client joins these seat ids onto the seating map (§10).
    async listReservations(actor: Actor): Promise<ReservationListResponse> {
      const reservations = await repository.listReservationsOf(actor.userId);
      return { items: reservations.map(toResponse) };
    },
  };
}
export type CinemaService = ReturnType<typeof createCinemaService>;

const rowOf = (reservation?: StoredReservation) =>
  reservation?.rowNumber === undefined ? [] : [reservation.rowNumber];

const sameSeats = (a: readonly string[], b: readonly string[]) => {
  const bs = new Set(b);
  return a.length === bs.size && a.every((id) => bs.has(id));
};

function toResponse(reservation: StoredReservation): ReservationResponse {
  if (reservation.status === "cancelled") throw new Error("cancelled reservation cannot be returned");
  return {
    id: reservation.id,
    status: reservation.status,
    expiresAt: reservation.expiresAt.toISOString(),
    seatIds: reservation.seatIds,
  };
}

// ARCHITECTURE §6's derivation table. A completed reservation never consults its deadline.
function deriveSeatStatus({ reservation }: SeatWithReservation, checkedAt: Date): SeatStatus {
  if (reservation?.status === "completed") return "booked";
  if (reservation?.status === "held" && reservation.expiresAt > checkedAt) return "reserved";
  return "available";
}
