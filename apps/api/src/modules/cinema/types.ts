// Reservation status as stored (the `holds.status` column). Never a seat status (ARCHITECTURE §11).
export type StoredReservationStatus = "held" | "completed" | "cancelled";

// A seat plus the reservation currently occupying it, if any. Status is derived from this, not stored.
export interface SeatWithReservation {
  id: string;
  rowLabel: string;
  seatNumber: number;
  reservation?: { status: StoredReservationStatus; expiresAt: Date };
}

// A reservation as stored. `rowNumber` is the row its seats are in; unset once they're released.
export interface StoredReservation {
  id: string;
  userId: string;
  status: StoredReservationStatus;
  expiresAt: Date;
  seatIds: string[];
  rowNumber?: number;
}
