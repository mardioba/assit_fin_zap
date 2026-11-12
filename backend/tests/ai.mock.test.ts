import { describe, expect, it } from "vitest";
import { interpretMock } from "../src/modules/ai/ai.mock.js";

describe("interpretMock — criação de movimentações", () => {
  it("interpreta despesa com valor, data e categoria", () => {
    const r = interpretMock("Hoje gastei 35 reais de combustível.");
    expect(r.intent).toBe("create_transaction");
    expect(r.transaction?.type).toBe("EXPENSE");
    expect(r.transaction?.amountCents).toBe(3500);
    expect(r.transaction?.description).toContain("combustível");
    expect(r.transaction?.categoryName).toBe("Transporte");
    expect(r.transaction?.date).toBe(new Date().toISOString().slice(0, 10));
    expect(r.ambiguous).toBe(false);
  });

  it("interpreta receita", () => {
    const r = interpretMock("Recebi 250 reais de um serviço.");
    expect(r.intent).toBe("create_transaction");
    expect(r.transaction?.type).toBe("INCOME");
    expect(r.transaction?.amountCents).toBe(25000);
    expect(r.transaction?.description).toContain("serviço");
  });

  it("interpreta despesa de energia com valor decimal", () => {
    const r = interpretMock("Paguei 120,50 reais de energia.");
    expect(r.transaction?.amountCents).toBe(12050);
    expect(r.transaction?.categoryName).toBe("Moradia");
  });

  it("marca como ambígua quando falta o valor", () => {
    const r = interpretMock("Gastei no almoço hoje");
    expect(r.intent).toBe("create_transaction");
    expect(r.ambiguous).toBe(true);
    expect(r.missing).toContain("valor");
  });

  it("entende 'ontem'", () => {
    const r = interpretMock("Ontem paguei 80 reais de farmácia");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(r.transaction?.date).toBe(yesterday.toISOString().slice(0, 10));
    expect(r.transaction?.amountCents).toBe(8000);
  });
});

describe("interpretMock — consultas", () => {
  it("resumo do mês atual", () => {
    const r = interpretMock("Quanto gastei esse mês?");
    expect(r.intent).toBe("query_summary");
    expect(r.query?.month).toBe(new Date().toISOString().slice(0, 7));
  });

  it("saldo disponível", () => {
    const r = interpretMock("Quanto tenho disponível?");
    expect(r.intent).toBe("query_balance");
  });

  it("consulta por categoria e mês (outubro)", () => {
    const r = interpretMock("Quanto gastei com combustível em outubro?");
    expect(r.intent).toBe("query_by_category");
    expect(r.query?.month).toMatch(/^\d{4}-10$/);
    expect(r.query?.categoryName).toBe("Transporte");
  });

  it("maiores gastos", () => {
    const r = interpretMock("Quais foram meus maiores gastos?");
    expect(r.intent).toBe("query_top_expenses");
  });

  it("mês passado", () => {
    const r = interpretMock("Quanto gastei no mês passado?");
    const last = new Date();
    last.setMonth(last.getMonth() - 1);
    expect(r.query?.month).toBe(`${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}`);
  });
});

describe("interpretMock — saudação e desconhecido", () => {
  it("saudação", () => {
    expect(interpretMock("Olá!").intent).toBe("greeting");
    expect(interpretMock("Bom dia").intent).toBe("greeting");
  });

  it("mensagem sem sentido vira unknown", () => {
    expect(interpretMock("xyzzy blorp 42").intent).toBe("unknown");
  });

  it("mensagem vazia é unknown", () => {
    expect(interpretMock("   ").intent).toBe("unknown");
  });
});
