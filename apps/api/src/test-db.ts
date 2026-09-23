import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import pg from "pg";
import { pino } from "pino";
import { migrate } from "./migrate";

// Integration tests only: the db-test compose service (tmpfs, port 5433).
// Matches docker-compose.yml; never the dev database.
const TEST_DATABASE_URL = "postgres://cinema:cinema@localhost:5433/cinema_test";

export const silentLogger = pino({ level: "silent" });

export async function testPool() {
  await migrate(TEST_DATABASE_URL, silentLogger);
  return new pg.Pool({ connectionString: TEST_DATABASE_URL });
}

// Fixture insert. Unique email per call, so test files never collide.
export async function insertUser(pool: pg.Pool, password: string) {
  const email = `user-${randomUUID()}@test.local`;
  const { rows } = await pool.query<{ id: string }>(
    "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
    [email, await bcrypt.hash(password, 10)],
  );
  const [row] = rows;
  if (!row) throw new Error("INSERT INTO users returned no row");
  return { id: row.id, email };
}
