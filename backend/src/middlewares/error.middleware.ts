import type { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";
import { env } from "../config/env.js";

type AuthedRequest = Request & {
  user?: { sub: string; email: string; role: string };
};

/** Erros do body-parser (JSON malformado, payload acima do limite). */
type BodyParserError = Error & {
  type?: string;
  status?: number;
  statusCode?: number;
  expose?: boolean;
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

  // JSON malformado / payload grande do express.json → 400/413, não 500.
  const bodyErr = err as BodyParserError;
  if (bodyErr?.type === "entity.parse.failed") {
    res.status(400).json({ message: "JSON inválido no corpo da requisição", code: "INVALID_JSON" });
    return;
  }
  if (bodyErr?.type === "entity.too.large") {
    res.status(413).json({ message: "Corpo da requisição muito grande", code: "PAYLOAD_TOO_LARGE" });
    return;
  }

  // Erros conhecidos do Prisma (portável SQLite/Postgres).
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002" || err.code === "P2001") {
      res.status(409).json({ message: "Registro duplicado", code: "CONFLICT" });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ message: "Registro não encontrado", code: "NOT_FOUND" });
      return;
    }
    if (err.code === "P2003") {
      res.status(400).json({
        message: "Operação inválida: registro vinculado a outros dados",
        code: "FK_CONSTRAINT",
      });
      return;
    }
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
