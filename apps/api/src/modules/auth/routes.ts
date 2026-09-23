import { type LoginRequest, loginRequest, type UserResponse } from "@cinema/contracts";
import { type CookieOptions, type RequestHandler, Router } from "express";
import { actorOf, TOKEN_COOKIE } from "../../middleware/auth";
import { type AuthService, TOKEN_LIFETIME_SECONDS } from "./service";

// Single origin behind the Vite proxy, so Strict costs nothing. Not `secure`: dev is plain http (§8).
const cookieOptions: CookieOptions = { httpOnly: true, sameSite: "strict", path: "/" };

export function authRouter(auth: AuthService, requireActor: RequestHandler) {
  const router = Router();

  router.post("/api/auth/login", async (req, res) => {
    const credentials: LoginRequest = loginRequest.parse(req.body);
    const { user, token } = await auth.login(credentials);
    res.cookie(TOKEN_COOKIE, token, { ...cookieOptions, maxAge: TOKEN_LIFETIME_SECONDS * 1000 });
    const body: UserResponse = user;
    res.json(body);
  });

  router.post("/api/auth/logout", (_req, res) => {
    res.clearCookie(TOKEN_COOKIE, cookieOptions);
    res.status(204).end();
  });

  router.get("/api/auth/me", requireActor, async (req, res) => {
    const body: UserResponse = await auth.getUser(actorOf(req));
    res.json(body);
  });

  return router;
}
