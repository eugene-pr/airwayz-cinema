import { z } from "zod";

export const healthResponse = z.object({
  ok: z.literal(true),
  serverTime: z.iso.datetime({ offset: true }),
});
export type HealthResponse = z.infer<typeof healthResponse>;
