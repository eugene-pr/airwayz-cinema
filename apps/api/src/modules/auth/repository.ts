import type pg from "pg";
import type { User, UserWithPasswordHash } from "./types";

export function createAuthRepository(pool: pg.Pool) {
  return {
    async findByEmail(email: string): Promise<UserWithPasswordHash | undefined> {
      const { rows } = await pool.query<{ id: string; email: string; password_hash: string }>(
        "SELECT id, email, password_hash FROM users WHERE email = $1",
        [email],
      );
      const [row] = rows;
      return row && { id: row.id, email: row.email, passwordHash: row.password_hash };
    },

    async findById(id: string): Promise<User | undefined> {
      const { rows } = await pool.query<{ id: string; email: string }>(
        "SELECT id, email FROM users WHERE id = $1",
        [id],
      );
      const [row] = rows;
      return row && { id: row.id, email: row.email };
    },
  };
}
