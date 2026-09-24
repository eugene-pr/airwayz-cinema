// Occupied means reserved or booked by someone else. The user's current seats are unoccupied and
// replaced: the selection releases them. Include the whole selected row, numbered 1 through N.
export type Seat = {
  id: string;
  rowNumber: number;
  seatNumber: number;
  occupied: boolean;
  replaced?: boolean;
};
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
  const numbers = selected.map((seat) => seat.seatNumber);
  const occupiedNumbers = (keep: (seat: Seat) => boolean | undefined) =>
    new Set(row.filter(keep).map((seat) => seat.seatNumber));
  const before = occupiedNumbers((seat) => seat.occupied || seat.replaced);
  const after = new Set([...occupiedNumbers((seat) => seat.occupied), ...numbers]);
  const lo = Math.min(...numbers);
  const hi = Math.max(...numbers);

  // Rule 2: only seats just outside the selection can become newly isolated. Ignore one that was
  // already isolated before the change (§5.2). Row edges pass: no occupied seat lies beyond the row.
  const isIsolated = (occupied: Set<number>, n: number) =>
    !occupied.has(n) && occupied.has(n - 1) && occupied.has(n + 1);
  const isolatedSeatNumbers = [lo - 1, hi + 1].filter((n) => isIsolated(after, n) && !isIsolated(before, n));
  return isolatedSeatNumbers.length > 0 ? { rule: 2, isolatedSeatNumbers } : null;
}

// Rule 1: seats must be together in one row, with no gaps or repeats.
function isRule1Met(selected: readonly Seat[]): boolean {
  const rowNumber = selected[0]?.rowNumber;
  if (selected.some((seat) => seat.rowNumber !== rowNumber)) return false;
  const numbers = selected.map((seat) => seat.seatNumber).sort((a, b) => a - b);
  return numbers.every((n, i) => i === 0 || n === (numbers[i - 1] as number) + 1);
}
