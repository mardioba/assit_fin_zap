import { describe, expect, it } from "vitest";
import { lastMonths, parseMonth } from "../src/lib/finance.js";

describe("parseMonth", () => {
  it("interpreta YYYY-MM em português (fuso local)", () => {
    const { start, end, key } = parseMonth("2026-11");
    expect(key).toBe("2026-11");
    expect(start).toEqual(new Date(2026, 10, 1));
    expect(end).toEqual(new Date(2026, 11, 1));
  });

  it("usa o mês atual por padrão", () => {
    const { key } = parseMonth();
    expect(key).toBe(new Date().toISOString().slice(0, 7));
  });

  it("rejeita formatos inválidos", () => {
    expect(() => parseMonth("11/2026")).toThrow();
    expect(() => parseMonth("2026-13")).toThrow();
    expect(() => parseMonth("2026-00")).toThrow();
  });
});

describe("lastMonths", () => {
  it("gera N meses ordenados do mais antigo ao mais recente", () => {
    const keys = lastMonths(3);
    expect(keys).toHaveLength(3);
    expect(keys[2]).toBe(new Date().toISOString().slice(0, 7));
  });
});
