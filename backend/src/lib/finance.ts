// Utilitários de período e categorias padrão (Fase 2).
import { badRequest } from "./errors.js";

export type MonthRange = { start: Date; end: Date; key: string };

/**
 * Interpreta "YYYY-MM" (padrão do projeto) e retorna o intervalo do mês.
 * Sem parâmetro, usa o mês atual. Lança erro para valores inválidos.
 */
export function parseMonth(month?: string): MonthRange {
  const key = month ?? new Date().toISOString().slice(0, 7);
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(key);
  if (!match) {
    throw badRequest(`Mês inválido: ${month} (use o formato YYYY-MM)`, "INVALID_MONTH");
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 1);
  return { start, end, key };
}

/** Últimos N meses (inclusive o atual), do mais antigo para o mais recente. */
export function lastMonths(count: number): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

export const TRANSACTION_TYPES = ["INCOME", "EXPENSE"] as const;
export const ACCOUNT_TYPES = ["BANK", "CASH", "WALLET"] as const;
export const PAYMENT_METHODS = ["PIX", "CASH", "CREDIT", "DEBIT", "TRANSFER", "OTHER"] as const;

/**
 * Categorias padrão criadas no cadastro de cada usuário.
 * São CONFIGURAÇÕES de uso — não dados financeiros fictícios (regra 11.5).
 */
export const DEFAULT_CATEGORIES: ReadonlyArray<{
  name: string;
  type: (typeof TRANSACTION_TYPES)[number];
}> = [
  { name: "Alimentação", type: "EXPENSE" },
  { name: "Transporte", type: "EXPENSE" },
  { name: "Moradia", type: "EXPENSE" },
  { name: "Saúde", type: "EXPENSE" },
  { name: "Educação", type: "EXPENSE" },
  { name: "Lazer", type: "EXPENSE" },
  { name: "Assinaturas", type: "EXPENSE" },
  { name: "Outros", type: "EXPENSE" },
  { name: "Salário", type: "INCOME" },
  { name: "Serviços", type: "INCOME" },
  { name: "Investimentos", type: "INCOME" },
  { name: "Outros", type: "INCOME" },
];
