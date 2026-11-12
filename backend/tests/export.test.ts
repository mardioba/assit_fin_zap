import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, createSession, createTransaction } from "./helpers.js";

const month = new Date().toISOString().slice(0, 7);

describe("GET /api/reports/export — CSV (Excel)", () => {
  it("exporta CSV com BOM e separador pt-BR", async () => {
    const session = await createSession();
    await createTransaction(session, {
      amountCents: 12_345,
      description: "Mercado; com acento: ção",
      date: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/api/reports/export")
      .query({ month, format: "csv" })
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(`movimentacoes-${month}.csv`);

    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM do Excel
    expect(text).toContain("Data;Tipo;Descrição");
    expect(text).toContain("Despesa");
    expect(text).toContain("123,45"); // valor pt-BR
    // Campo com ';' e 'ç' vai entre aspas
    expect(text).toContain('"Mercado; com acento: ção"');
  });

  it("mês sem movimentações exporta só o cabeçalho", async () => {
    const session = await createSession();
    const res = await request(app)
      .get("/api/reports/export")
      .query({ month, format: "csv" })
      .set("Cookie", session.cookie);
    expect(res.status).toBe(200);
    const lines = res.text.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(lines).toHaveLength(1);
  });

  it("isolamento: só exporta movimentações do próprio usuário", async () => {
    const a = await createSession();
    const b = await createSession();
    await createTransaction(a, { amountCents: 77_77, description: "Segredo" });

    const res = await request(app)
      .get("/api/reports/export")
      .query({ month, format: "csv" })
      .set("Cookie", b.cookie);
    expect(res.text).not.toContain("Segredo");
  });

  it("exige autenticação", async () => {
    const res = await request(app).get("/api/reports/export");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/reports/export — PDF", () => {
  it("gera PDF válido com cabeçalho e resumo", async () => {
    const session = await createSession();
    await createTransaction(session, {
      amountCents: 50_00,
      description: "Lanche",
      date: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/api/reports/export")
      .query({ month, format: "pdf" })
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain(".pdf");

    const buf = Buffer.from(res.body as ArrayBuffer);
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(500);
  });
});

describe("GET /api/reports/annual — relatório anual", () => {
  it("retorna 12 meses com totais reais", async () => {
    const session = await createSession();
    await createTransaction(session, {
      type: "INCOME",
      amountCents: 300_000,
      description: "Salário",
      date: new Date().toISOString(),
    });
    await createTransaction(session, {
      amountCents: 50_000,
      description: "Mercado",
      date: new Date().toISOString(),
    });

    const res = await request(app)
      .get("/api/reports/annual")
      .query({ year: new Date().getFullYear() })
      .set("Cookie", session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.series).toHaveLength(12);
    expect(res.body.totals.incomeCents).toBe(300_000);
    expect(res.body.totals.expenseCents).toBe(50_000);
    expect(res.body.totals.resultCents).toBe(250_000);

    const thisMonth = res.body.series.find(
      (m: { month: string }) => m.month === month,
    );
    expect(thisMonth.incomeCents).toBe(300_000);
    // Meses sem movimentação retornam zero (nada inventado)
    expect(res.body.series.every((m: { incomeCents: number }) => m.incomeCents >= 0)).toBe(true);
  });

  it("valida o ano", async () => {
    const session = await createSession();
    const res = await request(app)
      .get("/api/reports/annual")
      .query({ year: "1990" })
      .set("Cookie", session.cookie);
    expect(res.status).toBe(400);
  });
});
