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
