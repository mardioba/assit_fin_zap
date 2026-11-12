import type request from "supertest";

/** Extrai os cookies de uma resposta de forma segura para o TS. */
export function cookieArray(res: request.Response): string[] {
  const raw = res.headers["set-cookie"] as string | string[] | undefined;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

export function cookieHeader(res: request.Response): string {
  return cookieArray(res).join("; ");
}

export function findCookie(res: request.Response, name: string): string {
  const found = cookieArray(res).find((c) => c.startsWith(`${name}=`));
  if (!found) throw new Error(`Cookie ausente na resposta: ${name}`);
  return found;
}
