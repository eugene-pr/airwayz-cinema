// Occupied means reserved or booked by someone else. Mark the user's current seats as unoccupied.
// Include the whole selected row, numbered 1 through N.
export type Seat = { id: string; rowNumber: number; seatNumber: number; occupied: boolean };
export type RuleViolation = { rule: 1 } | { rule: 2; isolatedSeatNumbers: number[] };

function selectedSeats(seats: readonly Seat[], seatIds: readonly string[]): Seat[] {
  const byId = new Map(seats.map((seat) => [seat.id, seat]));
  const selected = seatIds.map((id) => {
    const seat = byId.get(id);
    if (!seat) throw new Error(`unknown seat id: ${id}`);
    return seat;
  });
  if (selected.length === 0) throw new Error("empty selection");
  return selected;
}

// Rule 1 depends only on seat positions, so callers can apply it before checking occupancy.
export function validateRule1(seats: readonly Seat[], seatIds: readonly string[]): { rule: 1 } | null {
  return isRule1Met(selectedSeats(seats, seatIds)) ? null : { rule: 1 };
}

// Check Rule 1, then Rule 2, even for a single seat.
// Throw for an empty selection, unknown seat ID, or occupied seat.
export function validateSelection(seats: readonly Seat[], seatIds: readonly string[]): RuleViolation | null {
  const selected = selectedSeats(seats, seatIds);

  if (!isRule1Met(selected)) return { rule: 1 };
  for (const seat of selected) {
    if (seat.occupied) throw new Error(`selected seat is occupied: ${seat.id}`);
  }
  const first = selected[0] as Seat;

  const row = seats.filter((seat) => seat.rowNumber === first.rowNumber);
  const occupied = new Set(row.filter((seat) => seat.occupied).map((seat) => seat.seatNumber));
  const numbers = selected.map((seat) => seat.seatNumber);
  const lo = Math.min(...numbers);
  const hi = Math.max(...numbers);

  // Rule 2: only seats just outside the selection can become newly isolated.
  // Reject an empty neighbour if its other side is occupied. Ignore existing isolated seats.
  // Row edges pass because there is no occupied seat beyond the row.
  const isIsolated = (n: number, farSide: number) => !occupied.has(n) && occupied.has(farSide);
  const isolatedSeatNumbers = [
    ...(isIsolated(lo - 1, lo - 2) ? [lo - 1] : []),
    ...(isIsolated(hi + 1, hi + 2) ? [hi + 1] : []),
  ];
  return isolatedSeatNumbers.length > 0 ? { rule: 2, isolatedSeatNumbers } : null;
}

// Rule 1: seats must be together in one row, with no gaps or repeats.
function isRule1Met(selected: readonly Seat[]): boolean {
  const rowNumber = selected[0]?.rowNumber;
  if (selected.some((seat) => seat.rowNumber !== rowNumber)) return false;
  const numbers = selected.map((seat) => seat.seatNumber).sort((a, b) => a - b);
  return numbers.every((n, i) => i === 0 || n === (numbers[i - 1] as number) + 1);
}
