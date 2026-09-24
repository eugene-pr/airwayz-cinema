import { z } from "zod";

export const healthResponse = z.object({
  ok: z.literal(true),
  serverTime: z.iso.datetime({ offset: true }),
});
export type HealthResponse = z.infer<typeof healthResponse>;

export const loginRequest = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof loginRequest>;

export const userResponse = z.object({
  id: z.uuid(),
  email: z.email(),
});
export type UserResponse = z.infer<typeof userResponse>;

// Derived server-side, never stored (ARCHITECTURE §6).
export const seatStatus = z.enum(["available", "reserved", "booked"]);
export type SeatStatus = z.infer<typeof seatStatus>;

export const seatResponse = z.object({
  id: z.uuid(),
  code: z.string(),
  rowLabel: z.string(),
  seatNumber: z.number().int(),
  status: seatStatus,
});
export type SeatResponse = z.infer<typeof seatResponse>;

export const seatingMapResponse = z.object({ items: z.array(seatResponse) });
export type SeatingMapResponse = z.infer<typeof seatingMapResponse>;

// Postgres accepts any case but returns lowercase; ids are compared as strings, so requests lowercase them.
const requestId = z.uuid().toLowerCase();

// The seats a request asks for (ARCHITECTURE §11). Seats go by id, never by code.
export const selectionRequest = z.object({ seatIds: z.array(requestId).min(1) });
export type SelectionRequest = z.infer<typeof selectionRequest>;

export const reservationParams = z.object({ id: requestId });

// Reservation statuses never cross with seat statuses (§11). Cancelled is never on the wire.
export const reservationStatus = z.enum(["held", "completed"]);
export type ReservationStatus = z.infer<typeof reservationStatus>;

export const reservationResponse = z.object({
  id: z.uuid(),
  status: reservationStatus,
  expiresAt: z.iso.datetime({ offset: true }),
  seatIds: z.array(z.uuid()),
});
export type ReservationResponse = z.infer<typeof reservationResponse>;

// The actor's own reservations only (ARCHITECTURE §10).
export const reservationListResponse = z.object({ items: z.array(reservationResponse) });
export type ReservationListResponse = z.infer<typeof reservationListResponse>;
