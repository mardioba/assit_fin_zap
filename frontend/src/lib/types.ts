export type User = {
  id: string;
  name: string;
  email: string;
  role: "USER" | "ADMIN";
  createdAt?: string;
};

export type DashboardSummary = {
  user: { name: string } | null;
  period: { start: string; end: string };
  totals: {
    balanceCents: number;
    incomeMonthCents: number;
    expenseMonthCents: number;
    resultMonthCents: number;
  };
  transactionsCount: number;
  pendingBillsPayable: number;
  pendingBillsReceivable: number;
  note?: string;
};

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
