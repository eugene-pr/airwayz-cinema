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
