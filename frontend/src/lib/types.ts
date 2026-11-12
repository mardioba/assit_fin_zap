export type User = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  createdAt?: string;
};

export type Category = {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  color: string | null;
  isDefault: boolean;
};

export type Account = {
  id: string;
  name: string;
  type: "BANK" | "CASH" | "WALLET";
  initialBalanceCents: number;
  balanceCents: number;
  isActive: boolean;
};

export type Transaction = {
  id: string;
  type: "INCOME" | "EXPENSE";
  amountCents: number;
  description: string;
  date: string;
  categoryId: string | null;
  accountId: string | null;
  paymentMethod: string | null;
  establishment: string | null;
  category: Category | null;
  account: { id: string; name: string } | null;
};

export type DashboardSummary = {
  user: { name: string } | null;
  period: { start: string; end: string; month: string };
  totals: {
    balanceCents: number;
    incomeMonthCents: number;
    expenseMonthCents: number;
    resultMonthCents: number;
  };
  transactionsCount: number;
  pendingBillsPayable: number;
  pendingBillsReceivable: number;
};

export type MonthlyPoint = {
  month: string;
  incomeCents: number;
  expenseCents: number;
  resultCents: number;
};

export type CategorySlice = {
  categoryId: string | null;
  categoryName: string;
  color: string | null;
  totalCents: number;
  count: number;
  percent: number;
};

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

/** Converte "35,50" | "35.50" para centavos. */
export function toCents(value: string): number {
  const cleaned = value.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === ",") {
    throw new Error("Valor monetário inválido");
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error("Valor monetário inválido");
  return Math.round(parsed * 100);
}

/** Converte centavos para texto decimal ("35,50"). */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}
