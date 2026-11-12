import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createAccount, createSession, createTransaction } from "./helpers.js";

describe("POST /api/transactions", () => {
  it("cria receita com categoria e conta", async () => {
    const session = await createSession();
    const accountId = await createAccount(session);
    const cats = await request(app)
      .get("/api/categories?type=INCOME")
      .set("Cookie", session.cookie);
    const salary = cats.body.categories.find((c: { name: string }) => c.name === "Salário");

    const res = await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "INCOME",
        amountCents: 250000,
        description: "Serviço prestado",
        date: "2026-11-10T12:00:00.000Z",
        categoryId: salary.id,
        accountId,
        paymentMethod: "PIX",
        establishment: "Cliente X",
      });

    expect(res.status).toBe(201);
    expect(res.body.transaction).toMatchObject({
      type: "INCOME",
      amountCents: 250000,
      paymentMethod: "PIX",
    });
    expect(res.body.transaction.category.name).toBe("Salário");
  });

  it("rejeita valor não positivo", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({ type: "EXPENSE", amountCents: -5, description: "x", date: "2026-11-10" });
    expect(res.status).toBe(400);
  });

  it("rejeita categoria de outro usuário (404)", async () => {
    const a = await createSession();
    const b = await createSession();
    const cats = await request(app).get("/api/categories").set("Cookie", a.cookie);
    const foreignCategory = cats.body.categories[0];

    const res = await request(app)
      .post("/api/transactions")
      .set("Cookie", b.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 1000,
        description: "x",
        date: "2026-11-10",
        categoryId: foreignCategory.id,
      });
    expect(res.status).toBe(404);
  });

  it("rejeita data inválida", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({ type: "EXPENSE", amountCents: 1000, description: "x", date: "ontem" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/transactions", () => {
  it("filtra por mês, tipo, busca e pagina", async () => {
    const session = await createSession();
    await createTransaction(session, {
      type: "EXPENSE",
      amountCents: 3500,
      description: "Combustível do carro",
      date: "2026-10-15T10:00:00.000Z",
    });
    await createTransaction(session, {
      type: "EXPENSE",
      amountCents: 12000,
      description: "Conta de energia",
      date: "2026-11-05T10:00:00.000Z",
    });
    await createTransaction(session, {
      type: "INCOME",
      amountCents: 50000,
      description: "Freelance",
      date: "2026-11-20T10:00:00.000Z",
    });

    const outubro = await request(app)
      .get("/api/transactions?month=2026-10")
      .set("Cookie", session.cookie);
    expect(outubro.body.total).toBe(1);
    expect(outubro.body.items[0].description).toBe("Combustível do carro");

    const novembro = await request(app)
      .get("/api/transactions?month=2026-11&type=INCOME")
      .set("Cookie", session.cookie);
    expect(novembro.body.total).toBe(1);
    expect(novembro.body.items[0].amountCents).toBe(50000);

    const busca = await request(app)
      .get("/api/transactions?search=energia")
      .set("Cookie", session.cookie);
    expect(busca.body.total).toBe(1);

    const paginada = await request(app)
      .get("/api/transactions?page=1&pageSize=2")
      .set("Cookie", session.cookie);
    expect(paginada.body.items).toHaveLength(2);
    expect(paginada.body.total).toBe(3);
    expect(paginada.body.page).toBe(1);
  });

  it("não retorna movimentações de outro usuário (isolamento)", async () => {
    const a = await createSession();
    const b = await createSession();
    await createTransaction(a, { description: "Segredo financeiro" });

    const res = await request(app).get("/api/transactions").set("Cookie", b.cookie);
    expect(res.body.total).toBe(0);
  });
});

describe("PATCH e DELETE /api/transactions/:id", () => {
  it("atualiza valor e descrição", async () => {
    const session = await createSession();
    const id = await createTransaction(session, { amountCents: 1000 });

    const res = await request(app)
      .patch(`/api/transactions/${id}`)
      .set("Cookie", session.cookie)
      .send({ amountCents: 2500, description: "Ajustado" });

    expect(res.status).toBe(200);
    expect(res.body.transaction.amountCents).toBe(2500);
    expect(res.body.transaction.description).toBe("Ajustado");
  });

  it("exclui movimentação com auditoria", async () => {
    const session = await createSession();
    const id = await createTransaction(session);

    const res = await request(app)
      .delete(`/api/transactions/${id}`)
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);

    const list = await request(app).get("/api/transactions").set("Cookie", session.cookie);
    expect(list.body.total).toBe(0);
  });

  it("não permite editar movimentação de outro usuário (404)", async () => {
    const a = await createSession();
    const b = await createSession();
    const id = await createTransaction(a);

    const res = await request(app)
      .patch(`/api/transactions/${id}`)
      .set("Cookie", b.cookie)
      .send({ amountCents: 1 });
    expect(res.status).toBe(404);
  });
});
