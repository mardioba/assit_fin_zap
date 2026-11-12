import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createAccount, createSession, createTransaction } from "./helpers.js";

async function seedNovember() {
  const session = await createSession();
  const accountId = await createAccount(session, { initialBalanceCents: 100000 });
  const cats = await request(app).get("/api/categories").set("Cookie", session.cookie);
  const byName = new Map<string, string>(
    cats.body.categories.map((c: { name: string; type: string; id: string }) => [
      `${c.type}:${c.name}`,
      c.id,
    ]),
  );

  // Novembro/2026 — dados de teste (regra de "sem dados fictícios" vale para produção).
  await createTransaction(session, {
    type: "INCOME",
    amountCents: 300000,
    description: "Salário",
    date: "2026-11-05T10:00:00.000Z",
    categoryId: byName.get("INCOME:Salário") ?? null,
    accountId,
  });
  await createTransaction(session, {
    type: "EXPENSE",
    amountCents: 3500,
    description: "Combustível",
    date: "2026-11-10T10:00:00.000Z",
    categoryId: byName.get("EXPENSE:Transporte") ?? null,
    accountId,
  });
  await createTransaction(session, {
    type: "EXPENSE",
    amountCents: 5000,
    description: "Almoço",
    date: "2026-11-12T10:00:00.000Z",
    categoryId: byName.get("EXPENSE:Alimentação") ?? null,
    accountId,
  });
  // Outubro/2026 — fora do período consultado.
  await createTransaction(session, {
    type: "EXPENSE",
    amountCents: 43000,
    description: "Combustível de outubro",
    date: "2026-10-20T10:00:00.000Z",
    categoryId: byName.get("EXPENSE:Transporte") ?? null,
    accountId,
  });

  return session;
}

describe("GET /api/reports/summary", () => {
  it("retorna receitas, despesas e resultado reais do mês", async () => {
    const session = await seedNovember();
    const res = await request(app)
      .get("/api/reports/summary?month=2026-11")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      month: "2026-11",
      incomeCents: 300000,
      expenseCents: 8500,
      resultCents: 291500,
      incomeCount: 1,
      expenseCount: 2,
    });
  });

  it("responde zeros para mês sem movimentações", async () => {
    const session = await createSession();
    const res = await request(app)
      .get("/api/reports/summary?month=2026-01")
      .set("Cookie", session.cookie);
    expect(res.body).toMatchObject({ incomeCents: 0, expenseCents: 0, resultCents: 0 });
  });

  it("rejeita mês com formato inválido", async () => {
    const session = await createSession();
    const res = await request(app)
      .get("/api/reports/summary?month=11-2026")
      .set("Cookie", session.cookie);
    expect(res.status).toBe(400);
  });
});

describe("GET /api/reports/by-category", () => {
  it("agrupa despesas por categoria com percentuais", async () => {
    const session = await seedNovember();
    const res = await request(app)
      .get("/api/reports/by-category?month=2026-11&type=EXPENSE")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.totalCents).toBe(8500);
    expect(res.body.byCategory).toHaveLength(2);
    expect(res.body.byCategory[0]).toMatchObject({ categoryName: "Alimentação", totalCents: 5000 });
    expect(res.body.byCategory[1]).toMatchObject({ categoryName: "Transporte", totalCents: 3500 });
    // 5000/8500 = 58.8%
    expect(res.body.byCategory[0].percent).toBeCloseTo(58.8, 0);
  });

  it("não contamina dados de outro usuário", async () => {
    const a = await seedNovember();
    const b = await createSession();
    const res = await request(app)
      .get("/api/reports/by-category?month=2026-11")
      .set("Cookie", b.cookie);
    expect(res.body.totalCents).toBe(0);
    expect(res.body.byCategory).toHaveLength(0);
    void a;
  });
});

describe("GET /api/reports/monthly", () => {
  it("retorna série mensal para gráficos", async () => {
    const session = await seedNovember();
    const res = await request(app)
      .get("/api/reports/monthly?months=3")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(3);
    const novembro = res.body.series.find((s: { month: string }) => s.month === "2026-11");
    expect(novembro).toMatchObject({ incomeCents: 300000, expenseCents: 8500 });
  });
});

describe("GET /api/dashboard/summary (valores reais — Fase 2)", () => {
  it("calcula saldo, receitas, despesas e resultado", async () => {
    const session = await seedNovember();
    const res = await request(app)
      .get("/api/dashboard/summary?month=2026-11")
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      // saldo = inicial 100000 + (300000 - 3500 - 5000 - 43000) = 348500
      balanceCents: 348500,
      incomeMonthCents: 300000,
      expenseMonthCents: 8500,
      resultMonthCents: 291500,
    });
    expect(res.body.transactionsCount).toBe(3);
    expect(res.body.period.month).toBe("2026-11");
  });
});
