import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { insertUser, silentLogger, testPool } from "../../test-db";

// HTTP seam: cookie handling and the auth middleware, which the service tests can't reach.
let pool: pg.Pool;
let server: Server;
let baseUrl: string;
let user: { id: string; email: string };

beforeAll(async () => {
  pool = await testPool();
  user = await insertUser(pool, "correct-password");
  const app = createApp({ pool, logger: silentLogger, jwtSecret: "test-only-jwt-secret-at-least-32-chars" });
  server = app.listen(0);
  baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await pool.end();
});

const login = (password: string) =>
  fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password }),
  });

const getAuthenticatedUser = (cookie?: string) =>
  fetch(`${baseUrl}/api/auth/me`, { headers: cookie ? { cookie } : {} });

describe("auth routes", () => {
  it("login sets an httpOnly cookie that authenticates /me, and logout clears it", async () => {
    const res = await login("correct-password");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: user.id, email: user.email });
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const cookie = setCookie.split(";")[0] ?? "";

    const authed = await getAuthenticatedUser(cookie);
    expect(authed.status).toBe(200);
    expect(await authed.json()).toEqual({ id: user.id, email: user.email });

    const out = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { cookie } });
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it("login with bad credentials is 401 and sets no cookie", async () => {
    const res = await login("wrong-password");
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(await res.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "Invalid email or password" },
    });
  });

  it.each([
    ["missing", undefined],
    ["invalid", "token=not-a-jwt"],
  ])("rejects a %s cookie with 401", async (_, cookie) => {
    const res = await getAuthenticatedUser(cookie);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
  });
});
