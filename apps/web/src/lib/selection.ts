import type { SeatResponse } from "@cinema/contracts";
import { type Seat, validateSelection } from "@cinema/seat-rules";

// What the draft selection currently breaks, for display only. The server re-validates
// whatever is submitted (ARCHITECTURE §2 #11); this only gates the submit button (§5.4).
export type DraftViolation =
  | { kind: "occupied"; codes: string[] }
  | { kind: "rule1" }
  | { kind: "rule2"; codes: string[] };

// The actor's own held seats count as unoccupied and replaced: replacing the selection releases them.
export function checkDraft(
  seats: readonly SeatResponse[],
  ownHeldSeatIds: ReadonlySet<string>,
  draft: readonly string[],
): DraftViolation | null {
  if (draft.length === 0) return null;
  const occupied = (seat: SeatResponse) => seat.status !== "available" && !ownHeldSeatIds.has(seat.id);

  // A poll can occupy a seat already in the draft; seat-rules throws on that, so name it first.
  const occupiedInDraft = seats.filter((seat) => draft.includes(seat.id) && occupied(seat));
  if (occupiedInDraft.length > 0)
    return { kind: "occupied", codes: occupiedInDraft.map((seat) => seat.code) };

  // The wire has no row number; seats arrive in row order, so the row's position stands in for it.
  const rowLabels = [...new Set(seats.map((seat) => seat.rowLabel))];
  const ruleSeats: Seat[] = seats.map((seat) => ({
    id: seat.id,
    rowNumber: rowLabels.indexOf(seat.rowLabel),
    seatNumber: seat.seatNumber,
    occupied: occupied(seat),
    replaced: ownHeldSeatIds.has(seat.id) && seat.status !== "available",
  }));

  const violation = validateSelection(ruleSeats, draft);
  if (!violation) return null;
  if (violation.rule === 1) return { kind: "rule1" };
  const rowLabel = seats.find((seat) => seat.id === draft[0])?.rowLabel;
  const isolated = seats.filter(
    (seat) => seat.rowLabel === rowLabel && violation.isolatedSeatNumbers.includes(seat.seatNumber),
  );
  return { kind: "rule2", codes: isolated.map((seat) => seat.code) };
}

export function describeDraftViolation(violation: DraftViolation): string {
  switch (violation.kind) {
    case "occupied":
      return `No longer available: ${violation.codes.join(", ")}. Deselect to continue.`;
    case "rule1":
      return "Rule 1: selected seats must be consecutive and in the same row.";
    case "rule2":
      return `Rule 2: this selection would leave an isolated seat (${violation.codes.join(", ")}).`;
  }
}
