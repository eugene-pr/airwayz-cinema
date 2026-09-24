// `npm run seed`: the api also seeds on boot, so this is only for re-seeding by hand.
import pg from "pg";
import { seedDev } from "./dev";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  const { users, seats } = await seedDev(pool);
  process.stdout.write(`inserted: ${users} users, ${seats} seats\n`);
} finally {
  await pool.end();
}
