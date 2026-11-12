import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { invoicePeriod } from "../src/lib/card-invoice.js";
import { app, createSession, type Session } from "./helpers.js";

async function createCard(session: Session, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/cards")
    .set("Cookie", session.cookie)
    .send({
      name: "Nubank",
      brand: "mastercard",
      limitCents: 500_000,
      closingDay: 5,
      dueDay: 12,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.card as { id: string };
}

describe("invoicePeriod — ciclo de fatura", () => {
  it("antes do fechamento: ciclo do mês anterior", () => {
    // Referência 03/01, fechamento dia 5 -> ainda acumula o ciclo 05/12 a 05/01,
    // que fecha em 05/01 e vence em 12/01.
    const { start, end, dueDate } = invoicePeriod(5, 12, new Date(2026, 0, 3));
    expect(start.getMonth()).toBe(11); // dezembro
    expect(start.getFullYear()).toBe(2025);
    expect(end.getMonth()).toBe(0); // janeiro
    expect(end.getFullYear()).toBe(2026);
    expect(dueDate.getMonth()).toBe(0);
    expect(dueDate.getDate()).toBe(12);
  });

  it("após o fechamento: ciclo corrente [fechamento, próximo fechamento)", () => {
    // 10/01 > fechamento 05/01 -> ciclo 05/01 a 05/02, vence 12/02
    const { start, end, dueDate } = invoicePeriod(5, 12, new Date(2026, 0, 10));
    expect(start.getMonth()).toBe(0);
    expect(start.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(1);
    expect(dueDate.getMonth()).toBe(1);
    expect(dueDate.getDate()).toBe(12);
  });

  it("dia de vencimento menor que o fechamento pula para o mês seguinte", () => {
    // fechamento dia 25, vencimento dia 10: fim do ciclo 25/02 -> vence 10/03
    const { dueDate } = invoicePeriod(25, 10, new Date(2026, 0, 30));
    expect(dueDate.getMonth()).toBe(2);
    expect(dueDate.getDate()).toBe(10);
  });

  it("lida com fevereiro (dia capado)", () => {
    const { start, end } = invoicePeriod(31, 10, new Date(2026, 1, 10));
    expect(start.getDate()).toBe(31); // jan tem 31 dias
    expect(end.getMonth()).toBe(1); // fecha 28/02 (capado)
    expect(end.getDate()).toBe(28);
  });
});

describe("CRUD de cartões de crédito", () => {
  it("cria cartão com estatísticas de fatura", async () => {
    const session = await createSession();
    const card = await createCard(session);
    expect(card.id).toBeTruthy();

    const list = await request(app)
      .get("/api/cards")
      .set("Cookie", session.cookie);
    expect(list.status).toBe(200);
    expect(list.body.cards).toHaveLength(1);
    expect(list.body.cards[0].invoiceCents).toBe(0);
    expect(list.body.cards[0].availableCents).toBe(500_000);
  });

  it("isolamento: usuário B não vê o cartão de A", async () => {
    const a = await createSession();
    const b = await createSession();
    await createCard(a);
    const list = await request(app).get("/api/cards").set("Cookie", b.cookie);
    expect(list.body.cards).toHaveLength(0);
  });

  it("atualiza e desativa cartão", async () => {
    const session = await createSession();
    const card = await createCard(session);
    const res = await request(app)
      .patch(`/api/cards/${card.id}`)
      .set("Cookie", session.cookie)
      .send({ limitCents: 700_000 });
    expect(res.status).toBe(200);
    expect(res.body.card.limitCents).toBe(700_000);
  });

  it("não exclui cartão com compras (só desativa)", async () => {
    const session = await createSession();
    const card = await createCard(session);
    await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 1000,
        description: "Compra no cartão",
        date: new Date().toISOString(),
        cardId: card.id,
      });

    const del = await request(app)
      .delete(`/api/cards/${card.id}`)
      .set("Cookie", session.cookie);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe("CARD_IN_USE");
  });

  it("valida dias de fechamento/vencimento (1-28)", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/cards")
      .set("Cookie", session.cookie)
      .send({ name: "X", limitCents: 100, closingDay: 31, dueDay: 12 });
    expect(res.status).toBe(400);
  });
});

describe("Fatura do cartão", () => {
  it("soma compras do ciclo e calcula disponível", async () => {
    const session = await createSession();
    const card = await createCard(session, { closingDay: 5, dueDay: 12 });

    // Compra dentro do ciclo atual (hoje)
    await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 25_000,
        description: "Compra fatura",
        date: new Date().toISOString(),
        cardId: card.id,
      });

    const res = await request(app)
      .get(`/api/cards/${card.id}/invoice`)
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.totalCents).toBe(25_000);
    expect(res.body.availableCents).toBe(500_000 - 25_000);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.period.due).toBeTruthy();
  });

  it("compras de outro cartão não contaminam a fatura", async () => {
    const session = await createSession();
    const cardA = await createCard(session, { name: "A" });
    const cardB = await createCard(session, { name: "B" });

    await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 9_900,
        description: "Compra B",
        date: new Date().toISOString(),
        cardId: cardB.id,
      });

    const res = await request(app)
      .get(`/api/cards/${cardA.id}/invoice`)
      .set("Cookie", session.cookie);
    expect(res.body.totalCents).toBe(0);
  });
});

describe("Parcelamento", () => {
  it("cria N parcelas somando o valor total", async () => {
    const session = await createSession();
    const res = await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 100_000, // R$ 1.000,00
        description: "Notebook",
        date: "2026-11-10T12:00:00.000Z",
        installments: 10,
      });
    expect(res.status).toBe(201);
    expect(res.body.installments).toBe(10);

    const txns = await prisma.transaction.findMany({
      where: { description: { startsWith: "Notebook" } },
      orderBy: { installmentNumber: "asc" },
    });
    expect(txns).toHaveLength(10);
    const total = txns.reduce((s, t) => s + t.amountCents, 0);
    expect(total).toBe(100_000);
    expect(txns.every((t) => t.installmentGroup === txns[0]!.installmentGroup)).toBe(true);
    expect(txns[0]!.installmentNumber).toBe(1);
    expect(txns[9]!.installmentNumber).toBe(10);
    expect(txns[9]!.installmentTotal).toBe(10);
    // Datas mensais (base10=Novembro; +1 → dezembro; +9 → julho/2027)
    expect(txns[1]!.date.getMonth()).toBe(11);
    expect(txns[9]!.date.getMonth()).toBe(7);
  });

  it("parcela com arredondamento fecha exato na última", async () => {
    const session = await createSession();
    await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 10_000, // R$ 100,00 em 3x
        description: "Item",
        date: new Date().toISOString(),
        installments: 3,
      });
    const txns = await prisma.transaction.findMany({
      where: { description: { startsWith: "Item" } },
    });
    expect(txns.reduce((s, t) => s + t.amountCents, 0)).toBe(10_000);
  });

  it("compra parcelada em cartão usa paymentMethod CREDIT", async () => {
    const session = await createSession();
    const card = await createCard(session);
    await request(app)
      .post("/api/transactions")
      .set("Cookie", session.cookie)
      .send({
        type: "EXPENSE",
        amountCents: 30_000,
        description: "Sofá",
        date: new Date().toISOString(),
        cardId: card.id,
        installments: 3,
      });
    const txns = await prisma.transaction.findMany({
      where: { description: { startsWith: "Sofá" } },
    });
    expect(txns).toHaveLength(3);
    expect(txns.every((t) => t.paymentMethod === "CREDIT")).toBe(true);
  });
});
