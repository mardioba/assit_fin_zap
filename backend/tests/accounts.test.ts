import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createAccount, createSession, createTransaction } from "./helpers.js";

describe("GET /api/accounts", () => {
  it("cria conta e retorna saldo inicial", async () => {
    const session = await createSession();
    const id = await createAccount(session, { initialBalanceCents: 50000 });

    const res = await request(app).get("/api/accounts").set("Cookie", session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.accounts).toHaveLength(1);
    expect(res.body.accounts[0]).toMatchObject({ id, balanceCents: 50000 });
  });

  it("calcula saldo real com receitas, despesas e transferências", async () => {
    const session = await createSession();
    const a = await createAccount(session, { name: "Banco A", initialBalanceCents: 100000 });
    const b = await createAccount(session, { name: "Carteira", initialBalanceCents: 0 });

    await createTransaction(session, { type: "INCOME", amountCents: 25000, accountId: a });
    await createTransaction(session, { type: "EXPENSE", amountCents: 7500, accountId: a });

    // Transferência de A para B: muda saldos, não é receita/despesa.
    const transfer = await request(app)
      .post("/api/accounts/transfer")
      .set("Cookie", session.cookie)
      .send({ fromAccountId: a, toAccountId: b, amountCents: 30000, description: "Movimentação" });
    expect(transfer.status).toBe(201);

    const res = await request(app).get("/api/accounts").set("Cookie", session.cookie);
    const byName = new Map<string, number>(
      res.body.accounts.map((acc: { name: string; balanceCents: number }) => [acc.name, acc.balanceCents]),
    );
    // A: 100000 + 25000 - 7500 - 30000 = 87500
    expect(byName.get("Banco A")).toBe(87500);
    // B: 0 + 30000
    expect(byName.get("Carteira")).toBe(30000);
  });

  it("não retorna contas de outro usuário (isolamento)", async () => {
    const a = await createSession();
    const b = await createSession();
    await createAccount(a, { name: "Conta Privada" });

    const res = await request(app).get("/api/accounts").set("Cookie", b.cookie);
    expect(res.body.accounts).toHaveLength(0);
  });
});

describe("POST /api/accounts", () => {
  it("valida tipo de conta inválido", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/accounts")
      .set("Cookie", session.cookie)
      .send({ name: "Inválida", type: "CRYPTO" });
    expect(res.status).toBe(400);
  });

  it("aceita os três tipos: BANK, CASH, WALLET", async () => {
    const session = await createSession();
    for (const type of ["BANK", "CASH", "WALLET"]) {
      const res = await request(app)
        .post("/api/accounts")
        .set("Cookie", session.cookie)
        .send({ name: `Conta ${type}`, type });
      expect(res.status).toBe(201);
    }
  });
});

describe("DELETE /api/accounts/:id", () => {
  it("exclui conta vazia", async () => {
    const session = await createSession();
    const id = await createAccount(session);
    const res = await request(app).delete(`/api/accounts/${id}`).set("Cookie", session.cookie);
    expect(res.status).toBe(200);
  });

  it("bloqueia exclusão de conta com movimentações (409)", async () => {
    const session = await createSession();
    const id = await createAccount(session);
    await createTransaction(session, { accountId: id });

    const res = await request(app).delete(`/api/accounts/${id}`).set("Cookie", session.cookie);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ACCOUNT_IN_USE");
  });

  it("não permite excluir conta de outro usuário (404)", async () => {
    const a = await createSession();
    const b = await createSession();
    const id = await createAccount(a);
    const res = await request(app).delete(`/api/accounts/${id}`).set("Cookie", b.cookie);
    expect(res.status).toBe(404);
  });
});

describe("POST /api/accounts/transfer", () => {
  it("rejeita transferência entre a mesma conta", async () => {
    const session = await createSession();
    const id = await createAccount(session);
    const res = await request(app)
      .post("/api/accounts/transfer")
      .set("Cookie", session.cookie)
      .send({ fromAccountId: id, toAccountId: id, amountCents: 100 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("SAME_ACCOUNT");
  });

  it("rejeita conta inexistente ou de outro usuário (404)", async () => {
    const a = await createSession();
    const b = await createSession();
    const own = await createAccount(a);
    const foreign = await createAccount(b);

    const res = await request(app)
      .post("/api/accounts/transfer")
      .set("Cookie", a.cookie)
      .send({ fromAccountId: own, toAccountId: foreign, amountCents: 100 });
    expect(res.status).toBe(404);
  });

  it("rejeita valor não positivo", async () => {
    const session = await createSession();
    const a = await createAccount(session);
    const b = await createAccount(session);
    const res = await request(app)
      .post("/api/accounts/transfer")
      .set("Cookie", session.cookie)
      .send({ fromAccountId: a, toAccountId: b, amountCents: 0 });
    expect(res.status).toBe(400);
  });
});
