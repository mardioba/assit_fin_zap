import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../lib/api";
import { formatBRL, type DashboardSummary } from "../lib/types";

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DashboardSummary>("/dashboard/summary")
      .then(setSummary)
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <p className="rounded-md bg-red-50 px-4 py-3 text-red-700">Erro: {error}</p>
    );
  }
  if (!summary) {
    return <p className="text-slate-500">Carregando dashboard…</p>;
  }

  const { totals, period } = summary;
  const month = new Date(period.start).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  const cards = [
    { label: "Saldo total", value: totals.balanceCents, color: "text-slate-800" },
    { label: "Receitas do mês", value: totals.incomeMonthCents, color: "text-emerald-600" },
    { label: "Despesas do mês", value: totals.expenseMonthCents, color: "text-red-600" },
    {
      label: "Resultado do mês",
      value: totals.resultMonthCents,
      color: totals.resultMonthCents >= 0 ? "text-emerald-600" : "text-red-600",
    },
  ];

  const chartData = [
    { periodo: month, Receitas: totals.incomeMonthCents / 100, Despesas: totals.expenseMonthCents / 100 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500">Período: {month}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${card.color}`}>
              {formatBRL(card.value)}
            </p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-700">Receitas × Despesas</h2>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="periodo" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => formatBRL(Number(v) * 100)} />
              <Legend />
              <Bar dataKey="Receitas" fill="#059669" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Despesas" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-700">Resumo</h2>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-slate-500">Contas a pagar pendentes</span>
              <span className="font-medium">{summary.pendingBillsPayable}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-500">Contas a receber pendentes</span>
              <span className="font-medium">{summary.pendingBillsReceivable}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-500">Movimentações no período</span>
              <span className="font-medium">{summary.transactionsCount}</span>
            </li>
          </ul>
          {summary.note && (
            <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {summary.note}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
