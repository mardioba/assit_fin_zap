import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatBRL, toCents } from "../lib/types";

type Bill = {
  id: string;
  type: "PAYABLE" | "RECEIVABLE";
  description: string;
  amountCents: number;
  dueDate: string;
  paidAt: string | null;
  status: "OPEN" | "OVERDUE" | "PAID" | "RECEIVED";
};

const STATUS_LABEL: Record<Bill["status"], { label: string; cls: string }> = {
  OPEN: { label: "Em aberto", cls: "bg-slate-100 text-slate-600" },
  OVERDUE: { label: "Atrasada", cls: "bg-red-100 text-red-700" },
  PAID: { label: "Paga", cls: "bg-emerald-100 text-emerald-700" },
  RECEIVED: { label: "Recebida", cls: "bg-emerald-100 text-emerald-700" },
};

const EMPTY_FORM = {
  type: "PAYABLE" as "PAYABLE" | "RECEIVABLE",
  description: "",
  amount: "",
  dueDate: new Date().toISOString().slice(0, 10),
};

export function BillsPage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [counts, setCounts] = useState({ open: 0, overdue: 0 });
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (typeFilter) params.set("type", typeFilter);
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      const res = await api<{ bills: Bill[]; openCount: number; overdueCount: number }>(
        `/bills?${params}`,
      );
      setBills(res.bills);
      setCounts({ open: res.openCount, overdue: res.overdueCount });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar contas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, statusFilter]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/bills", {
        method: "POST",
        body: {
          type: form.type,
          description: form.description,
          amountCents: toCents(form.amount),
          dueDate: new Date(`${form.dueDate}T12:00:00`).toISOString(),
        },
      });
      setForm({ ...EMPTY_FORM, type: form.type });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verifique os dados");
    }
  }

  async function togglePaid(bill: Bill) {
    const paid = bill.status === "PAID" || bill.status === "RECEIVED";
    try {
      await api(`/bills/${bill.id}/pay`, { method: "POST", body: { undo: paid } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao atualizar");
    }
  }

  async function handleDelete(bill: Bill) {
    if (!confirm(`Excluir "${bill.description}"?`)) return;
    try {
      await api(`/bills/${bill.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao excluir");
    }
  }

  async function runReminders() {
    setMessage(null);
    try {
      const res = await api<{ sent: number }>("/bills/run-reminders", { method: "POST" });
      setMessage(
        res.sent > 0
          ? `${res.sent} lembrete(s) enviado(s) pelo WhatsApp.`
          : "Nenhum lembrete a enviar agora.",
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao enviar lembretes");
    }
  }

  const totalOpen = bills
    .filter((b) => b.status === "OPEN" || b.status === "OVERDUE")
    .reduce((s, b) => s + (b.type === "PAYABLE" ? -b.amountCents : b.amountCents), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Contas a pagar / receber</h1>
          <p className="text-sm text-slate-500">
            {counts.open} em aberto · {counts.overdue} atrasada(s)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => void runReminders()}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Enviar lembretes agora
          </button>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            {showForm ? "Cancelar" : "+ Nova conta"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {message && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Tipo</label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as "PAYABLE" | "RECEIVABLE" })
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="PAYABLE">A pagar</option>
                <option value="RECEIVABLE">A receber</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Descrição</label>
              <input
                required
                maxLength={160}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Valor (R$)</label>
              <input
                required
                inputMode="decimal"
                placeholder="0,00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Vencimento</label>
              <input
                type="date"
                required
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
          </div>
          <button
            type="submit"
            className="mt-3 rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
          >
            Salvar conta
          </button>
        </form>
      )}

      <div className="flex flex-wrap gap-3">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Pagar e receber</option>
          <option value="PAYABLE">A pagar</option>
          <option value="RECEIVABLE">A receber</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="ALL">Todos os status</option>
          <option value="OPEN">Em aberto</option>
          <option value="OVERDUE">Atrasadas</option>
          <option value="PAID">Pagas/recebidas</option>
        </select>
        <span className="self-center text-sm text-slate-500">
          Resultado das em aberto:{" "}
          <span className={totalOpen < 0 ? "text-red-600" : "text-emerald-600"}>
            {formatBRL(totalOpen)}
          </span>
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Vencimento</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Carregando…
                </td>
              </tr>
            ) : bills.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma conta no filtro.
                </td>
              </tr>
            ) : (
              bills.map((bill) => {
                const st = STATUS_LABEL[bill.status];
                const paid = bill.status === "PAID" || bill.status === "RECEIVED";
                return (
                  <tr key={bill.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-700">{bill.description}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {bill.type === "PAYABLE" ? "A pagar" : "A receber"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(bill.dueDate).toLocaleDateString("pt-BR")}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${
                        bill.type === "PAYABLE" ? "text-red-600" : "text-emerald-600"
                      }`}
                    >
                      {formatBRL(bill.amountCents)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => void togglePaid(bill)}
                        className="text-emerald-700 hover:underline"
                      >
                        {paid ? "Desfazer" : bill.type === "PAYABLE" ? "Pagar" : "Receber"}
                      </button>
                      <button
                        onClick={() => void handleDelete(bill)}
                        className="ml-3 text-red-600 hover:underline"
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
