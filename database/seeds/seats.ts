import type pg from "pg";

// The seating map (TASK.md, ARCHITECTURE §6): 10 rows of 10, then 3 rows of 5 — 115 seats.
const ROW_SIZES = [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 5, 5, 5];

// Idempotent. Shared by `npm run seed` and the integration-test bootstrap.
export async function seedSeats(db: pg.Pool | pg.ClientBase): Promise<number> {
  const rowNumbers: number[] = [];
  const rowLabels: string[] = [];
  const seatNumbers: number[] = [];
  ROW_SIZES.forEach((size, i) => {
    for (let seat = 1; seat <= size; seat++) {
      rowNumbers.push(i + 1);
      rowLabels.push(String.fromCharCode(65 + i));
      seatNumbers.push(seat);
    }
  });
  const { rowCount } = await db.query(
    `INSERT INTO seats (row_number, row_label, seat_number)
     SELECT * FROM unnest($1::int[], $2::text[], $3::int[])
     ON CONFLICT (row_number, seat_number) DO NOTHING`,
    [rowNumbers, rowLabels, seatNumbers],
  );
  return rowCount ?? 0;
}
