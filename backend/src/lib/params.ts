import type { Request } from "express";
import { notFound } from "./errors.js";

/** Extrai e valida o path param `:id` (Express pode tipar como array). */
export function paramId(req: Request, label = "Recurso"): string {
  const id = req.params.id;
  if (typeof id !== "string" || id.length === 0) {
    throw notFound(`${label} não encontrado`);
  }
  return id;
}
