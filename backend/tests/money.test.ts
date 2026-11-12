import { describe, expect, it } from "vitest";
import { formatBRL, toCents } from "../src/lib/money.js";

describe("money", () => {
  it("converte valores para centavos", () => {
    expect(toCents("35")).toBe(3500);
    expect(toCents("35.50")).toBe(3550);
    expect(toCents("R$ 1.234,56")).toBe(123456);
    expect(toCents(0.1)).toBe(10);
    expect(toCents("0,05")).toBe(5);
  });

  it("lança erro em valor inválido", () => {
    expect(() => toCents("abc")).toThrow();
  });

  it("formata em BRL", () => {
    // \s casa com o espaço não separável (U+00A0) usado pelo Intl.
    expect(formatBRL(3550)).toMatch(/^R\$\s35,50$/);
    expect(formatBRL(0)).toMatch(/^R\$\s0,00$/);
  });
});
