import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import {
  centsToInput,
  formatDate,
  formatBRL,
  toCents,
  type Account,
  type Category,
  type Transaction,
} from "../lib/types";

const EMPTY_FORM = {
  type: "EXPENSE" as "INCOME" | "EXPENSE",
  amount: "",
  description: "",
  date: new Date().toISOString().slice(0, 10),
  categoryId: "",
  accountId: "",
  paymentMethod: "",
  establishment: "",
};

export function TransactionsPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [items, setItems] = useState<Transaction[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ month, pageSize: "50" });
      if (typeFilter) params.set("type", typeFilter);
      if (search) params.set("search", search);
      const [list, cats, accs] = await Promise.all([
        api<{ items: Transaction[]; total: number }>(`/transactions?${params}`),
        api<{ categories: Category[] }>("/categories"),
        api<{ accounts: Account[] }>("/accounts"),
      ]);
      setItems(list.items);
      setTotal(list.total);
      setCategories(cats.categories);
      setAccounts(accs.accounts);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, typeFilter]);

  function startEdit(t: Transaction) {
    setEditingId(t.id);
    setForm({
      type: t.type,
      amount: centsToInput(t.amountCents),
      description: t.description,
      date: t.date.slice(0, 10),
      categoryId: t.categoryId ?? "",
      accountId: t.accountId ?? "",
      paymentMethod: t.paymentMethod ?? "",
      establishment: t.establishment ?? "",
    });
    setShowForm(true);
    setError(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, date: new Date().toISOString().slice(0, 10) });
    setShowForm(false);
    setError(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const payload = {
        type: form.type,
        amountCents: toCents(form.amount),
        description: form.description,
        date: new Date(`${form.date}T12:00:00`).toISOString(),
        categoryId: form.categoryId || null,
        accountId: form.accountId || null,
        paymentMethod: form.paymentMethod || null,
        establishment: form.establishment || null,
      };
      if (editingId) {
        await api(`/transactions/${editingId}`, { method: "PATCH", body: payload });
      } else {
        await api("/transactions", { method: "POST", body: payload });
      }
      resetForm();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verifique os dados informados");
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Excluir esta movimentação?")) return;
    try {
      await api(`/transactions/${id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao excluir");
    }
  }

  const filteredCats = categories.filter((c) => c.type === form.type);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Movimentações</h1>
          <p className="text-sm text-slate-500">{total} registro(s) em {month}</p>
        </div>
        <button
          onClick={() => (showForm ? resetForm() : setShowForm(true))}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {showForm ? "Cancelar" : "+ Nova movimentação"}
        </button>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Tipo</label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as "INCOME" | "EXPENSE" })
                }
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="EXPENSE">Despesa</option>
                <option value="INCOME">Receita</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Valor (R$)</label>
              <input
                type="text"
                required
                inputMode="decimal"
                placeholder="0,00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Data</label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-1">
              <label className="mb-1 block text-sm font-medium text-slate-700">Descrição</label>
              <input
                type="text"
                required
                maxLength={160}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Categoria</label>
              <select
                value={form.categoryId}
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">— Sem categoria —</option>
                {filteredCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Conta</label>
              <select
                value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">— Sem conta —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Pagamento</label>
              <select
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              >
                <option value="">—</option>
                <option value="PIX">PIX</option>
                <option value="CASH">Dinheiro</option>
                <option value="CREDIT">Crédito</option>
                <option value="DEBIT">Débito</option>
                <option value="TRANSFER">Transferência</option>
                <option value="OTHER">Outro</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Estabelecimento</label>
              <input
                type="text"
                maxLength={120}
                value={form.establishment}
                onChange={(e) => setForm({ ...form, establishment: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div className="flex items-end">
              <button
                type="submit"
                className="w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
              >
                {editingId ? "Salvar alterações" : "Registrar"}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="flex flex-wrap gap-3">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value || new Date().toISOString().slice(0, 7))}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <input
          type="search"
          placeholder="Buscar por descrição…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          <option value="">Todos os tipos</option>
          <option value="INCOME">Receitas</option>
          <option value="EXPENSE">Despesas</option>
        </select>
        <button
          onClick={() => void load()}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Atualizar
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="px-4 py-3">Data</th>
              <th className="px-4 py-3">Descrição</th>
              <th className="px-4 py-3">Categoria</th>
              <th className="px-4 py-3">Conta</th>
              <th className="px-4 py-3 text-right">Valor</th>
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
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  Nenhuma movimentação no período.
                </td>
              </tr>
            ) : (
              items.map((t) => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500">{formatDate(t.date)}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">
                    {t.description}
                    {t.establishment && (
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        {t.establishment}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {t.category?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{t.account?.name ?? "—"}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${
                      t.type === "INCOME" ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {t.type === "INCOME" ? "+" : "−"} {formatBRL(t.amountCents)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => startEdit(t)}
                      className="text-emerald-700 hover:underline"
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => void handleDelete(t.id)}
                      className="ml-3 text-red-600 hover:underline"
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
