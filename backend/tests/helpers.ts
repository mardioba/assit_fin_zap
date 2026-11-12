import request from "supertest";
import { createApp } from "../src/app.js";

const app = createApp();

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

export type Session = { cookie: string; userId: string; email: string };

let seq = 0;

/** Registra e loga um usuário de teste; devolve o cookie de sessão. */
export async function createSession(
  overrides: { email?: string; name?: string } = {},
): Promise<Session> {
  seq += 1;
  const email = overrides.email ?? `user${seq}-${Date.now()}@teste.com`;
  const name = overrides.name ?? `Usuário Teste ${seq}`;

  const reg = await request(app).post("/api/auth/register").send({
    name,
    email,
    password: "senhaSegura123",
  });
  if (reg.status !== 201) {
    throw new Error(`Falha ao registrar usuário de teste: ${reg.status} ${reg.text}`);
  }
  return { cookie: cookieHeader(reg), userId: reg.body.user.id as string, email };
}

/** Cria uma conta de teste e devolve o id. */
export async function createAccount(
  session: Session,
  overrides: Partial<{ name: string; type: string; initialBalanceCents: number }> = {},
): Promise<string> {
  const res = await request(app)
    .post("/api/accounts")
    .set("Cookie", session.cookie)
    .send({
      name: overrides.name ?? "Conta Teste",
      type: overrides.type ?? "BANK",
      initialBalanceCents: overrides.initialBalanceCents ?? 0,
    });
  if (res.status !== 201) {
    throw new Error(`Falha ao criar conta de teste: ${res.status} ${res.text}`);
  }
  return res.body.account.id as string;
}

/** Cria uma movimentação de teste e devolve o id. */
export async function createTransaction(
  session: Session,
  overrides: Partial<{
    type: string;
    amountCents: number;
    description: string;
    date: string;
    categoryId: string | null;
    accountId: string | null;
  }> = {},
): Promise<string> {
  const res = await request(app)
    .post("/api/transactions")
    .set("Cookie", session.cookie)
    .send({
      type: overrides.type ?? "EXPENSE",
      amountCents: overrides.amountCents ?? 1000,
      description: overrides.description ?? "Gasto de teste",
      date: overrides.date ?? new Date().toISOString(),
      ...(overrides.categoryId !== undefined ? { categoryId: overrides.categoryId } : {}),
      ...(overrides.accountId !== undefined ? { accountId: overrides.accountId } : {}),
    });
  if (res.status !== 201) {
    throw new Error(`Falha ao criar movimentação de teste: ${res.status} ${res.text}`);
  }
  return res.body.transaction.id as string;
}

export { app };
