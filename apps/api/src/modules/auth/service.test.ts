import jwt from "jsonwebtoken";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { insertUser, testPool } from "../../test-db";
import { createAuthService } from "./index";

const JWT_SECRET = "test-only-jwt-secret-at-least-32-chars";

let pool: pg.Pool;
let user: { id: string; email: string };
let auth: ReturnType<typeof createAuthService>;

beforeAll(async () => {
  pool = await testPool();
  user = await insertUser(pool, "correct-password");
  auth = createAuthService({ pool, jwtSecret: JWT_SECRET });
});
afterAll(() => pool.end());

describe("login", () => {
  it("returns the user and a token that verifies to them as actor", async () => {
    const result = await auth.login({ email: user.email, password: "correct-password" });

    expect(result.user).toEqual({ id: user.id, email: user.email });
    expect(auth.verifyToken(result.token)).toEqual({ userId: user.id });
  });

  it("rejects unknown email and wrong password with the same 401", async () => {
    const unknownEmail = auth.login({ email: "nobody@test.local", password: "correct-password" });
    const wrongPassword = auth.login({ email: user.email, password: "wrong-password" });

    const expected = { status: 401, code: "UNAUTHORIZED", message: "Invalid email or password" };
    await expect(unknownEmail).rejects.toMatchObject(expected);
    await expect(wrongPassword).rejects.toMatchObject(expected);
  });
});

describe("verifyToken", () => {
  it.each([
    ["garbage", () => "not-a-jwt"],
    [
      "signed with another secret",
      () => jwt.sign({}, "some-other-secret-at-least-32-chars", { subject: user.id }),
    ],
    ["expired", () => jwt.sign({}, JWT_SECRET, { subject: user.id, expiresIn: -1 })],
    ["unsigned (alg none)", () => jwt.sign({}, "", { subject: user.id, algorithm: "none" })],
    ["without a subject", () => jwt.sign({}, JWT_SECRET)],
  ])("rejects a token that is %s", (_, token) => {
    expect(auth.verifyToken(token())).toBeUndefined();
  });
});

describe("getUser", () => {
  it("returns the actor's id and email", async () => {
    expect(await auth.getUser({ userId: user.id })).toEqual({ id: user.id, email: user.email });
  });

  it("rejects an actor whose user no longer exists with 401", async () => {
    const gone = auth.getUser({ userId: "00000000-0000-0000-0000-000000000000" });
    await expect(gone).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
  });
});
