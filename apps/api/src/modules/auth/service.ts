import type { LoginRequest } from "@cinema/contracts";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type pg from "pg";
import { unauthorized } from "../../middleware/app-error";
import { createAuthRepository } from "./repository";
import type { Actor, User } from "./types";

export const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60;
const BCRYPT_COST = 10;
const UNKNOWN_EMAIL_HASH = bcrypt.hashSync("unknown-email", BCRYPT_COST);

export interface AuthServiceDeps {
  pool: pg.Pool;
  jwtSecret: string;
}

export function createAuthService({ pool, jwtSecret }: AuthServiceDeps) {
  const users = createAuthRepository(pool);

  return {
    async login({ email, password }: LoginRequest): Promise<{ user: User; token: string }> {
      const found = await users.findByEmail(email);
      // Compare even for an unknown email, so response time doesn't reveal which emails exist.
      const matches = await bcrypt.compare(password, found?.passwordHash ?? UNKNOWN_EMAIL_HASH);
      if (!found || !matches) throw unauthorized("Invalid email or password");
      const token = jwt.sign({}, jwtSecret, {
        algorithm: "HS256",
        subject: found.id,
        expiresIn: TOKEN_LIFETIME_SECONDS,
      });
      return { user: { id: found.id, email: found.email }, token };
    },

    // A valid token for a user that no longer exists is as good as no token.
    async getUser(actor: Actor): Promise<User> {
      const user = await users.findById(actor.userId);
      if (!user) throw unauthorized();
      return user;
    },

    verifyToken(token: string): Actor | undefined {
      try {
        const payload = jwt.verify(token, jwtSecret, { algorithms: ["HS256"] });
        return typeof payload === "object" && payload.sub ? { userId: payload.sub } : undefined;
      } catch {
        return undefined;
      }
    },
  };
}
export type AuthService = ReturnType<typeof createAuthService>;
