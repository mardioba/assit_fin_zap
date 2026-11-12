import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, ApiError } from "../lib/api";
import {
  formatBRL,
  type CategorySlice,
  type DashboardSummary,
  type MonthlyPoint,
} from "../lib/types";

const PALETTE = [
  "#059669", "#dc2626", "#0284c7", "#d97706", "#7c3aed",
  "#db2777", "#0d9488", "#65a30d", "#64748b", "#ea580c",
];

export function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [monthly, setMonthly] = useState<MonthlyPoint[]>([]);
  const [byCategory, setByCategory] = useState<CategorySlice[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<DashboardSummary>("/dashboard/summary"),
      api<{ series: MonthlyPoint[] }>("/reports/monthly?months=6"),
      api<{ byCategory: CategorySlice[]; totalCents: number }>(
        "/reports/by-category?type=EXPENSE",
      ),
    ])
      .then(([s, m, c]) => {
        setSummary(s);
        setMonthly(m.series);
        setByCategory(c.byCategory);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return <p className="rounded-md bg-red-50 px-4 py-3 text-red-700">Erro: {error}</p>;
  }
  if (!summary) {
    return <p className="text-slate-500">Carregando dashboard…</p>;
  }

  const { totals, period } = summary;

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

  const chartData = monthly.map((p) => ({
    month: p.month.slice(5),
    Receitas: p.incomeCents / 100,
    Despesas: p.expenseCents / 100,
  }));

  const categoryData = byCategory.map((c, i) => ({
    name: c.categoryName,
    valor: c.totalCents / 100,
    fill: c.color ?? PALETTE[i % PALETTE.length],
  }));

  const monthLabel = new Date(`${period.month}-01T12:00:00`).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Período: {monthLabel} · {summary.transactionsCount} movimentação(ões)
        </p>
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
          <h2 className="mb-3 font-medium text-slate-700">Receitas × Despesas (6 meses)</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip formatter={(v) => formatBRL(Number(v) * 100)} />
              <Legend />
              <Bar dataKey="Receitas" fill="#059669" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Despesas" fill="#dc2626" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-700">Despesas por categoria (mês)</h2>
          {categoryData.length === 0 ? (
            <p className="text-sm text-slate-400">Sem despesas categorizadas no período.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={categoryData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={12} />
                <YAxis type="category" dataKey="name" width={110} fontSize={12} />
                <Tooltip formatter={(v) => formatBRL(Number(v) * 100)} />
                <Bar dataKey="valor" radius={[0, 4, 4, 0]}>
                  {categoryData.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-slate-700">Maiores despesas do mês</h2>
        {categoryData.length === 0 ? (
          <p className="text-sm text-slate-400">Nada a exibir ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {byCategory.slice(0, 5).map((c) => (
              <li key={c.categoryName} className="flex justify-between py-2">
                <span className="text-slate-600">
                  {c.categoryName}{" "}
                  <span className="text-xs text-slate-400">({c.count} lançamento(s))</span>
                </span>
                <span className="font-medium text-slate-800">
                  {formatBRL(c.totalCents)}{" "}
                  <span className="text-xs font-normal text-slate-400">{c.percent}%</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
