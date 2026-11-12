import { Prisma } from "@prisma/client";

/** Detecta violação de unique do Prisma (portável SQLite/Postgres). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2002" || err.code === "P2001")
  );
}
