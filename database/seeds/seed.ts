// Idempotent, re-runnable: `npm run seed`. Assumes migrations have run.
import bcrypt from "bcryptjs";
import pg from "pg";

// Dev logins (ARCHITECTURE §2 #28). No registration exists (ARCHITECTURE §2 #8), so these are the only users.
const USERS = [
  { email: "alice@example.com", password: "password" },
  { email: "bob@example.com", password: "password" },
  { email: "carol@example.com", password: "password" },
  { email: "dave@example.com", password: "password" },
  { email: "erin@example.com", password: "password" },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  for (const { email, password } of USERS) {
    const { rowCount } = await client.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING",
      [email, await bcrypt.hash(password, 10)],
    );
    process.stdout.write(`users: ${email} ${rowCount ? "inserted" : "already present"}\n`);
  }
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}
