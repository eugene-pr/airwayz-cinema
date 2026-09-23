// Reservation status as stored (the `holds.status` column). Never a seat status (ARCHITECTURE §11).
export type ReservationStatus = "held" | "completed" | "cancelled";

// A seat plus the reservation currently occupying it, if any. Status is derived from this, not stored.
export interface SeatWithReservation {
  id: string;
  rowLabel: string;
  seatNumber: number;
  reservation?: { status: ReservationStatus; expiresAt: Date };
}
