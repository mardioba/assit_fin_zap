import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { materializeRecurring } from "../src/modules/recurring/recurring.routes.js";
import { app, createSession, type Session } from "./helpers.js";

async function createRule(session: Session, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/recurring")
    .set("Cookie", session.cookie)
    .send({
      type: "EXPENSE",
      amountCents: 45_00,
      description: "Internet",
      dayOfMonth: 10,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.rule as { id: string };
}

describe("Regras de recorrência — CRUD", () => {
  it("cria, lista, atualiza e exclui", async () => {
    const session = await createSession();
    const rule = await createRule(session);

    const list = await request(app)
      .get("/api/recurring")
      .set("Cookie", session.cookie);
    expect(list.body.rules).toHaveLength(1);

    const upd = await request(app)
      .patch(`/api/recurring/${rule.id}`)
      .set("Cookie", session.cookie)
      .send({ amountCents: 5_500, active: false });
    expect(upd.status).toBe(200);
    expect(upd.body.rule.amountCents).toBe(5_500);
    expect(upd.body.rule.active).toBe(false);

    const del = await request(app)
      .delete(`/api/recurring/${rule.id}`)
      .set("Cookie", session.cookie);
    expect(del.status).toBe(200);
    expect(
      (await request(app).get("/api/recurring").set("Cookie", session.cookie)).body.rules,
    ).toHaveLength(0);
  });

  it("isolamento entre usuários", async () => {
    const a = await createSession();
    const b = await createSession();
    const rule = await createRule(a);

    const del = await request(app)
      .delete(`/api/recurring/${rule.id}`)
      .set("Cookie", b.cookie);
    expect(del.status).toBe(404);
  });

  it("valida dia do mês (1-28)", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/recurring")
      .set("Cookie", session.cookie)
      .send({ type: "EXPENSE", amountCents: 100, description: "X", dayOfMonth: 30 });
    expect(res.status).toBe(400);
  });
});

describe("Materialização de recorrências", () => {
  it("cria a movimentação do mês corrente", async () => {
    const session = await createSession();
    await createRule(session);

    const created = await materializeRecurring(session.userId);
    expect(created).toBe(1);

    const txn = await prisma.transaction.findFirst({
      where: { userId: session.userId },
    });
    expect(txn).toBeTruthy();
    expect(txn!.description).toBe("Internet");
    expect(txn!.amountCents).toBe(4500);
    expect(txn!.date.getDate()).toBe(10);
  });

  it("é idempotente (dedupe por recurrenceKey)", async () => {
    const session = await createSession();
    await createRule(session);

    expect(await materializeRecurring(session.userId)).toBe(1);
    expect(await materializeRecurring(session.userId)).toBe(0);
    expect(await materializeRecurring(session.userId)).toBe(0);
    expect(await prisma.transaction.count({ where: { userId: session.userId } })).toBe(1);
  });

  it("só materializa regras ativas", async () => {
    const session = await createSession();
    await createRule(session, { active: false });
    expect(await materializeRecurring(session.userId)).toBe(0);
  });

  it("não materializa regras de outro usuário", async () => {
    const a = await createSession();
    const b = await createSession();
    await createRule(a);

    expect(await materializeRecurring(b.userId)).toBe(0);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it("dia capado em meses curtos (dia 28 existe sempre)", async () => {
    const session = await createSession();
    await createRule(session, { dayOfMonth: 28 });
    expect(await materializeRecurring(session.userId)).toBe(1);
    const txn = await prisma.transaction.findFirst({ where: { userId: session.userId } });
    expect(txn!.date.getDate()).toBeLessThanOrEqual(28);
  });

  it("POST /api/recurring/run materializa para o usuário atual", async () => {
    const session = await createSession();
    await createRule(session);
    const res = await request(app)
      .post("/api/recurring/run")
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);

    const again = await request(app)
      .post("/api/recurring/run")
      .set("Cookie", session.cookie);
    expect(again.body.created).toBe(0);
  });
});
