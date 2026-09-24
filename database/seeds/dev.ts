import bcrypt from "bcryptjs";
import type pg from "pg";
import { seedSeats } from "./seats";

// Dev logins (ARCHITECTURE §2 #28). No registration exists (ARCHITECTURE §2 #8), so these are the only users.
const USERS = [
  { email: "alice@example.com", password: "password" },
  { email: "bob@example.com", password: "password" },
  { email: "carol@example.com", password: "password" },
  { email: "dave@example.com", password: "password" },
  { email: "erin@example.com", password: "password" },
];

// Idempotent, one transaction. Run by api boot (main.ts) and `npm run seed`. Assumes migrations have run.
export async function seedDev(pool: pg.Pool): Promise<{ users: number; seats: number }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let users = 0;
    for (const { email, password } of USERS) {
      const { rowCount } = await client.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
        [email, await bcrypt.hash(password, 10)],
      );
      users += rowCount ?? 0;
    }
    const seats = await seedSeats(client);
    await client.query("COMMIT");
    return { users, seats };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
