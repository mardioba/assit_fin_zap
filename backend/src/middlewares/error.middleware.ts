import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";

type AuthedRequest = Request & {
  user?: { sub: string; email: string; role: string };
};

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      message: "Dados inválidos",
      code: "VALIDATION_ERROR",
      errors: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.statusCode).json({ message: err.message, code: err.code });
    return;
  }

  console.error(`[error] ${req.method} ${req.path}:`, err);
  res.status(500).json({
    message: "Erro interno do servidor",
    code: "INTERNAL_ERROR",
    ...(env.isTest ? { detail: String(err) } : {}),
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ message: "Rota não encontrada", code: "NOT_FOUND" });
}

export type { AuthedRequest };
