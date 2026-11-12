import type { NextFunction, Request, Response } from "express";
import { unauthorized, forbidden } from "../lib/errors.js";
import { verifyAccessToken, type JwtPayload } from "../modules/auth/auth.tokens.js";
import type { AuthedRequest } from "./error.middleware.js";

/** Exige cookie accessToken válido; injeta req.user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.accessToken as string | undefined;
  if (!token) {
    next(unauthorized());
    return;
  }
  try {
    (req as AuthedRequest).user = verifyAccessToken(token);
    next();
  } catch {
    next(unauthorized("Sessão expirada", "TOKEN_EXPIRED"));
  }
}

/** Restringe a usuários com role ADMIN. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const user = (req as AuthedRequest).user;
  if (!user) {
    next(unauthorized());
    return;
  }
  if (user.role !== "ADMIN") {
    next(forbidden("Requer permissão de administrador"));
    return;
  }
  next();
}
