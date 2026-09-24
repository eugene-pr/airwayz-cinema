import type { SeatResponse } from "@cinema/contracts";

type Props = {
  seats: readonly SeatResponse[];
  selection: readonly string[];
  ownSeatIds: ReadonlySet<string>;
  onToggle: (seatId: string) => void;
  // True while a write is in flight, so the draft can't change under it.
  locked: boolean;
};

// Seats are never disabled by the seat rules — only by being occupied by someone else, or by a
// write in flight (ARCHITECTURE §5.4). Rows render edge to edge: there is no aisle (§5.3).
export function SeatingMap({ seats, selection, ownSeatIds, onToggle, locked }: Props) {
  const rows = new Map<string, SeatResponse[]>();
  for (const seat of seats) rows.set(seat.rowLabel, [...(rows.get(seat.rowLabel) ?? []), seat]);

  return (
    <div className="seating-map">
      <div className="screen">Screen</div>
      {[...rows].map(([rowLabel, rowSeats]) => (
        <div className="row" key={rowLabel}>
          <span className="row-label">{rowLabel}</span>
          {rowSeats.map((seat) => {
            const selected = selection.includes(seat.id);
            const own = ownSeatIds.has(seat.id);
            // A selected seat stays clickable even if a poll shows it occupied, so it can be deselected.
            const clickable = selected || seat.status === "available" || (own && seat.status === "reserved");
            const classes = ["seat", seat.status, own && "own", selected && "selected"]
              .filter(Boolean)
              .join(" ");
            return (
              <button
                type="button"
                key={seat.id}
                className={classes}
                disabled={locked || !clickable}
                aria-pressed={selected}
                aria-label={`${seat.code}, ${seat.status}${own ? ", yours" : ""}`}
                title={`${seat.code} — ${seat.status}${own ? " (yours)" : ""}`}
                onClick={() => onToggle(seat.id)}
              >
                {seat.seatNumber}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
