import { describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma.js";
import { outbox } from "../src/modules/whatsapp/whatsapp.client.js";
import { billStatus, runBillReminders } from "../src/modules/bills/bills.routes.js";
import { app, createSession, type Session } from "./helpers.js";

const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

async function createBill(
  session: Session,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post("/api/bills")
    .set("Cookie", session.cookie)
    .send({
      type: "PAYABLE",
      description: "Conta de luz",
      amountCents: 15_000,
      dueDate: daysFromNow(3),
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.bill as { id: string };
}

describe("billStatus — status derivado (nunca armazenado)", () => {
  const base = { type: "PAYABLE", dueDate: new Date(2026, 10, 10) };

  it("pago → PAID/RECEIVED", () => {
    expect(billStatus({ ...base, paidAt: new Date() })).toBe("PAID");
    expect(billStatus({ ...base, type: "RECEIVABLE", paidAt: new Date() })).toBe("RECEIVED");
  });

  it("aberto sem vencer → OPEN", () => {
    const future = new Date();
    future.setDate(future.getDate() + 2);
    expect(billStatus({ ...base, dueDate: future, paidAt: null })).toBe("OPEN");
  });

  it("vencido e não pago → OVERDUE", () => {
    const past = new Date();
    past.setDate(past.getDate() - 2);
    expect(billStatus({ ...base, dueDate: past, paidAt: null })).toBe("OVERDUE");
  });

  it("vence hoje ainda é OPEN (atraso só após o dia)", () => {
    const today = new Date();
    expect(billStatus({ ...base, dueDate: today, paidAt: null })).toBe("OPEN");
  });
});

describe("Contas a pagar/receber — API", () => {
  it("cria e lista com status calculado", async () => {
    const session = await createSession();
    await createBill(session);
    const res = await request(app).get("/api/bills").set("Cookie", session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.bills).toHaveLength(1);
    expect(res.body.bills[0].status).toBe("OPEN");
    expect(res.body.openCount).toBe(1);
  });

  it("conta vencida aparece como OVERDUE", async () => {
    const session = await createSession();
    await createBill(session, { dueDate: daysFromNow(-2) });
    const res = await request(app).get("/api/bills").set("Cookie", session.cookie);
    expect(res.body.bills[0].status).toBe("OVERDUE");
    expect(res.body.overdueCount).toBe(1);
  });

  it("pagar e desfazer", async () => {
    const session = await createSession();
    const bill = await createBill(session);

    const paid = await request(app)
      .post(`/api/bills/${bill.id}/pay`)
      .set("Cookie", session.cookie)
      .send({});
    expect(paid.body.bill.status).toBe("PAID");
    expect(paid.body.bill.paidAt).toBeTruthy();

    const undone = await request(app)
      .post(`/api/bills/${bill.id}/pay`)
      .set("Cookie", session.cookie)
      .send({ undo: true });
    expect(undone.body.bill.status).toBe("OPEN");
    expect(undone.body.bill.paidAt).toBeNull();
  });

  it("filtro por tipo e mês", async () => {
    const session = await createSession();
    await createBill(session, { type: "PAYABLE" });
    await createBill(session, { type: "RECEIVABLE", description: "Cliente" });

    const payable = await request(app)
      .get("/api/bills?type=PAYABLE")
      .set("Cookie", session.cookie);
    expect(payable.body.bills).toHaveLength(1);
    expect(payable.body.bills[0].description).toBe("Conta de luz");

    const receivable = await request(app)
      .get("/api/bills?type=RECEIVABLE")
      .set("Cookie", session.cookie);
    expect(receivable.body.bills).toHaveLength(1);
    expect(receivable.body.bills[0].description).toBe("Cliente");
  });

  it("isolamento entre usuários", async () => {
    const a = await createSession();
    const b = await createSession();
    const bill = await createBill(a);
    const res = await request(app)
      .patch(`/api/bills/${bill.id}`)
      .set("Cookie", b.cookie)
      .send({ description: "hackeada" });
    expect(res.status).toBe(404);
  });

  it("exclui conta", async () => {
    const session = await createSession();
    const bill = await createBill(session);
    const del = await request(app)
      .delete(`/api/bills/${bill.id}`)
      .set("Cookie", session.cookie);
    expect(del.status).toBe(200);
    expect(
      (await request(app).get("/api/bills").set("Cookie", session.cookie)).body.bills,
    ).toHaveLength(0);
  });

  it("dashboard soma contas em aberto", async () => {
    const session = await createSession();
    await createBill(session, { type: "PAYABLE" });
    await createBill(session, { type: "RECEIVABLE", description: "Receber" });
    const res = await request(app)
      .get("/api/dashboard/summary")
      .set("Cookie", session.cookie);
    expect(res.body.pendingBillsPayable).toBe(1);
    expect(res.body.pendingBillsReceivable).toBe(1);
  });
});

describe("Lembretes via WhatsApp", () => {
  it("avisa contas vencendo amanhã/atrásadas UMA vez (anti-spam)", async () => {
    const session = await createSession();
    await request(app).patch("/api/users/me").set("Cookie", session.cookie).send({
      whatsappPhone: "5511999990001",
    });

    await createBill(session, { dueDate: daysFromNow(1) }); // vence amanhã
    await createBill(session, { dueDate: daysFromNow(-1), description: "Atrasada" });
    await createBill(session, { dueDate: daysFromNow(10), description: "Futura" });

    const sent = await runBillReminders();
    expect(sent).toBe(2); // só amanhã e atrasada
    expect(outbox).toHaveLength(2);
    expect(outbox[0]!.body).toContain("Lembrete");
    expect(outbox.some((m) => m.body.includes("ATRASADA"))).toBe(true);

    // Segunda execução: nada novo (remindedAt preenchido).
    expect(await runBillReminders()).toBe(0);
    expect(outbox).toHaveLength(2);
  });

  it("não envia para usuário sem telefone vinculado", async () => {
    const session = await createSession();
    await createBill(session, { dueDate: daysFromNow(1) });
    expect(await runBillReminders()).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it("conta paga não recebe lembrete", async () => {
    const session = await createSession();
    await request(app).patch("/api/users/me").set("Cookie", session.cookie).send({
      whatsappPhone: "5511999990001",
    });
    const bill = await createBill(session, { dueDate: daysFromNow(1) });
    await request(app)
      .post(`/api/bills/${bill.id}/pay`)
      .set("Cookie", session.cookie)
      .send({});

    expect(await runBillReminders()).toBe(0);
    expect(outbox).toHaveLength(0);
  });

  it("mudar o vencimento reativa o lembrete", async () => {
    const session = await createSession();
    await request(app).patch("/api/users/me").set("Cookie", session.cookie).send({
      whatsappPhone: "5511999990001",
    });
    const bill = await createBill(session, { dueDate: daysFromNow(1) });
    await runBillReminders();
    expect(await runBillReminders()).toBe(0); // já avisada

    // Adia o vencimento: remindedAt é zerado e o novo prazo recebe aviso.
    await request(app)
      .patch(`/api/bills/${bill.id}`)
      .set("Cookie", session.cookie)
      .send({ dueDate: daysFromNow(1), description: "Conta de luz (adiada)" });
    const row = await prisma.bill.findUnique({ where: { id: bill.id } });
    expect(row!.remindedAt).toBeNull();
    expect(await runBillReminders()).toBe(1);
    expect(outbox).toHaveLength(2);
  });

  it("POST /api/bills/run-reminders executa via API", async () => {
    const session = await createSession();
    await request(app).patch("/api/users/me").set("Cookie", session.cookie).send({
      whatsappPhone: "5511999990001",
    });
    await createBill(session, { dueDate: daysFromNow(1) });
    const res = await request(app)
      .post("/api/bills/run-reminders")
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(1);
  });
});
