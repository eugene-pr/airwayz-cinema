import type { Request, RequestHandler } from "express";
import type { Actor, AuthService } from "../modules/auth";
import { unauthorized } from "./app-error";

// httpOnly JWT cookie (ARCHITECTURE §2 #7). Set and cleared by auth routes, read here.
export const TOKEN_COOKIE = "token";

declare global {
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

// Verifies the cookie and attaches the actor; anything else is 401.
export function authenticate(auth: AuthService): RequestHandler {
  return (req, _res, next) => {
    const token: unknown = req.cookies?.[TOKEN_COOKIE];
    const actor = typeof token === "string" ? auth.verifyToken(token) : undefined;
    if (!actor) return next(unauthorized());
    req.actor = actor;
    next();
  };
}

// For handlers mounted behind `authenticate`.
export function actorOf(req: Request): Actor {
  if (!req.actor) throw unauthorized();
  return req.actor;
}
