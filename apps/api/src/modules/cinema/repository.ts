import type pg from "pg";
import type { ReservationStatus, SeatWithReservation } from "./types";

// SQL says hold; everything above this file says reservation (ARCHITECTURE §10).
export function createCinemaRepository(pool: pg.Pool) {
  return {
    // One statement, so the seats and the database time they're judged against are one snapshot.
    async listSeats(): Promise<{ checkedAt: Date; seats: SeatWithReservation[] }> {
      const { rows } = await pool.query<{
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
  };
}
