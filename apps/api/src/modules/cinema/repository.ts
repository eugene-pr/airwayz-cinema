import type pg from "pg";
import type { ReservationStatus, SeatWithReservation, StoredReservation } from "./types";

// Advisory-lock namespaces (ARCHITECTURE §3.1): user keys and seat-row keys never collide.
export const USER_LOCK_NAMESPACE = 1;
export const ROW_LOCK_NAMESPACE = 2;

// The `id`/`user_id` filter goes in `where`; seats come back in row order.
const reservationQuery = (where: string) =>
  `SELECT h.id, h.user_id, h.status, h.expires_at,
          COALESCE(array_agg(c.seat_id ORDER BY s.seat_number) FILTER (WHERE c.seat_id IS NOT NULL), '{}')
            AS seat_ids,
          min(s.row_number) AS row_number
   FROM holds h
   LEFT JOIN seat_claims c ON c.hold_id = h.id
   LEFT JOIN seats s ON s.id = c.seat_id
   WHERE ${where}
   GROUP BY h.id`;

type ReservationRow = {
  id: string;
  user_id: string;
  status: ReservationStatus;
  expires_at: Date;
  seat_ids: string[];
  row_number: number | null;
};

const toReservation = (row: ReservationRow): StoredReservation => ({
  id: row.id,
  userId: row.user_id,
  status: row.status,
  expiresAt: row.expires_at,
  seatIds: row.seat_ids,
  rowNumber: row.row_number ?? undefined,
});

// SQL says hold; everything above this file says reservation (ARCHITECTURE §10).
// Takes the pool for plain reads, or a transaction's client for the §3.1 write path.
export function createCinemaRepository(db: pg.Pool | pg.ClientBase) {
  return {
    // One statement, so the seats and the database time they're judged against are one snapshot.
    async listSeats(): Promise<{ checkedAt: Date; seats: SeatWithReservation[] }> {
      const { rows } = await db.query<{
        checked_at: Date;
        id: string;
        row_label: string;
        seat_number: number;
        hold_status: ReservationStatus | null;
        expires_at: Date | null;
      }>(
        `WITH t AS (SELECT clock_timestamp() AS checked_at)
         SELECT t.checked_at, s.id, s.row_label, s.seat_number, h.status AS hold_status, h.expires_at
         FROM seats s
         CROSS JOIN t
         LEFT JOIN seat_claims c ON c.seat_id = s.id
         LEFT JOIN holds h ON h.id = c.hold_id
         ORDER BY s.row_number, s.seat_number`,
      );
      const [first] = rows;
      if (!first) throw new Error("seats table is empty — run `npm run seed`");
      return {
        checkedAt: first.checked_at,
        seats: rows.map((row) => ({
          id: row.id,
          rowLabel: row.row_label,
          seatNumber: row.seat_number,
          // expires_at is NOT NULL, so it is set whenever a hold joined.
          reservation: row.hold_status
            ? { status: row.hold_status, expiresAt: row.expires_at as Date }
            : undefined,
        })),
      };
    },

    // Seats are immutable after seed, so this is safe to read before any lock.
    async findSeatRows(seatIds: readonly string[]): Promise<{ id: string; rowNumber: number }[]> {
      const { rows } = await db.query<{ id: string; row_number: number }>(
        "SELECT id, row_number FROM seats WHERE id = ANY($1::uuid[])",
        [seatIds],
      );
      return rows.map((row) => ({ id: row.id, rowNumber: row.row_number }));
    },

    async lockUser(userId: string): Promise<void> {
      await db.query("SELECT pg_advisory_xact_lock($1, hashtext($2))", [USER_LOCK_NAMESPACE, userId]);
    },

    async lockRow(rowNumber: number): Promise<void> {
      await db.query("SELECT pg_advisory_xact_lock($1, $2)", [ROW_LOCK_NAMESPACE, rowNumber]);
    },

    // A separate statement, run after every lock is held (§3.1). Not now(): that froze at BEGIN.
    async checkedAt(): Promise<Date> {
      const { rows } = await db.query<{ checked_at: Date }>("SELECT clock_timestamp() AS checked_at");
      const [row] = rows;
      if (!row) throw new Error("clock_timestamp returned no row");
      return row.checked_at;
    },

    async findReservation(id: string): Promise<StoredReservation | undefined> {
      const { rows } = await db.query<ReservationRow>(reservationQuery("h.id = $1"), [id]);
      return rows[0] && toReservation(rows[0]);
    },

    // Includes an expired hold not yet reclaimed — the unique index still counts it (§4).
    async findHeldReservationOf(userId: string): Promise<StoredReservation | undefined> {
      const { rows } = await db.query<ReservationRow>(
        reservationQuery("h.user_id = $1 AND h.status = 'held'"),
        [userId],
      );
      return rows[0] && toReservation(rows[0]);
    },

    // Reclamation (§4): expire every held hold in these seat rows whose deadline has passed,
    // and release its claims. Callers hold the row locks.
    async reclaimExpired(rowNumbers: readonly number[], checkedAt: Date): Promise<void> {
      await db.query(
        `WITH expired AS (
           SELECT DISTINCT h.id FROM holds h
           JOIN seat_claims c ON c.hold_id = h.id
           JOIN seats s ON s.id = c.seat_id
           WHERE s.row_number = ANY($1::int[]) AND h.status = 'held' AND h.expires_at <= $2
         ), released AS (
           DELETE FROM seat_claims WHERE hold_id IN (SELECT id FROM expired)
         )
         UPDATE holds SET status = 'cancelled' WHERE id IN (SELECT id FROM expired)`,
        [rowNumbers, checkedAt],
      );
    },

    // Every seat in these rows, with the reservation claiming it, if any.
    async listRowSeats(
      rowNumbers: readonly number[],
    ): Promise<{ id: string; rowNumber: number; seatNumber: number; reservationId?: string }[]> {
      const { rows } = await db.query<{
        id: string;
        row_number: number;
        seat_number: number;
        hold_id: string | null;
      }>(
        `SELECT s.id, s.row_number, s.seat_number, c.hold_id
         FROM seats s LEFT JOIN seat_claims c ON c.seat_id = s.id
         WHERE s.row_number = ANY($1::int[])
         ORDER BY s.row_number, s.seat_number`,
        [rowNumbers],
      );
      return rows.map((row) => ({
        id: row.id,
        rowNumber: row.row_number,
        seatNumber: row.seat_number,
        reservationId: row.hold_id ?? undefined,
      }));
    },

    async insertReservation(userId: string, expiresAt: Date): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        "INSERT INTO holds (user_id, status, expires_at) VALUES ($1, 'held', $2) RETURNING id",
        [userId, expiresAt],
      );
      const [row] = rows;
      if (!row) throw new Error("reservation insert returned no row");
      return row.id;
    },

    async claimSeats(reservationId: string, seatIds: readonly string[]): Promise<void> {
      await db.query("INSERT INTO seat_claims (hold_id, seat_id) SELECT $1, unnest($2::uuid[])", [
        reservationId,
        seatIds,
      ]);
    },

    async releaseSeats(reservationId: string): Promise<void> {
      await db.query("DELETE FROM seat_claims WHERE hold_id = $1", [reservationId]);
    },
  };
}
export type CinemaRepository = ReturnType<typeof createCinemaRepository>;
