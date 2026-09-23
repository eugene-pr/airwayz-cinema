import { z } from "zod";

// The only place process.env is read. DATABASE_URL and JWT_SECRET have no
// defaults: the app refuses to boot without them.
const schema = z.object({
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Invalid environment:\n${issues}`);
}

export const config = Object.freeze({
  databaseUrl: parsed.data.DATABASE_URL,
  jwtSecret: parsed.data.JWT_SECRET,
  port: parsed.data.PORT,
  logLevel: parsed.data.LOG_LEVEL,
});
export type Config = typeof config;
