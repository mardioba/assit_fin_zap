import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatBRL, toCents, centsToInput } from "../lib/types";

type Card = {
  id: string;
  name: string;
  brand: string | null;
  limitCents: number;
  closingDay: number;
  dueDay: number;
  isActive: boolean;
  invoiceCents: number;
  invoiceCount: number;
  futureInstallmentsCents: number;
  availableCents: number;
  invoiceDue: string;
};

type InvoiceItem = {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  installmentNumber: number | null;
  installmentTotal: number | null;
  category: { name: string } | null;
};

const EMPTY_FORM = { name: "", brand: "", limit: "", closingDay: "5", dueDay: "12" };

export function CardsPage() {
  const [cards, setCards] = useState<Card[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invoiceCard, setInvoiceCard] = useState<Card | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await api<{ cards: Card[] }>("/cards");
      setCards(res.cards);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar cartões");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api("/cards", {
        method: "POST",
        body: {
          name: form.name,
          brand: form.brand || null,
          limitCents: toCents(form.limit),
          closingDay: Number(form.closingDay),
          dueDay: Number(form.dueDay),
        },
      });
      setForm(EMPTY_FORM);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verifique os dados");
    }
  }

  async function handleDelete(card: Card) {
    if (!confirm(`Excluir o cartão "${card.name}"?`)) return;
    try {
      await api(`/cards/${card.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao excluir");
    }
  }

  async function openInvoice(card: Card) {
    setError(null);
    try {
      const res = await api<{ items: InvoiceItem[] }>(`/cards/${card.id}/invoice`);
      setInvoiceCard(card);
      setInvoiceItems(res.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao abrir fatura");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Cartões de crédito</h1>
          <p className="text-sm text-slate-500">
            Fatura por ciclo de fechamento, parcelas e limite disponível
          </p>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          {showForm ? "Cancelar" : "+ Novo cartão"}
        </button>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Nome</label>
              <input
                required
                maxLength={60}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Nubank"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Bandeira</label>
              <input
                value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="visa / mastercard"
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Limite (R$)</label>
              <input
                required
                inputMode="decimal"
                placeholder="5.000,00"
                value={form.limit}
                onChange={(e) => setForm({ ...form, limit: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Fechamento</label>
              <input
                type="number"
                min={1}
                max={28}
                value={form.closingDay}
                onChange={(e) => setForm({ ...form, closingDay: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Vencimento</label>
              <input
                type="number"
                min={1}
                max={28}
                value={form.dueDay}
                onChange={(e) => setForm({ ...form, dueDay: e.target.value })}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>
          </div>
          <button
            type="submit"
            className="mt-3 rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
          >
            Salvar cartão
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {loading ? (
          <p className="text-slate-400">Carregando…</p>
        ) : cards.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhum cartão cadastrado ainda.</p>
        ) : (
          cards.map((card) => (
            <div key={card.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="font-semibold text-slate-800">
                    {card.name}
                    {card.brand && (
                      <span className="ml-2 text-xs font-normal uppercase text-slate-400">
                        {card.brand}
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-500">
                    Fecha dia {card.closingDay} · vence dia {card.dueDay}
                  </p>
                </div>
                <button
                  onClick={() => void handleDelete(card)}
                  className="text-red-600 hover:underline"
                >
                  Excluir
                </button>
              </div>

              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-slate-500">Fatura</dt>
                  <dd className="font-medium text-slate-700">
                    {formatBRL(card.invoiceCents)}
                    <span className="ml-1 text-xs text-slate-400">({card.invoiceCount})</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Parcelas futuras</dt>
                  <dd className="font-medium text-slate-700">
                    {formatBRL(card.futureInstallmentsCents)}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Disponível</dt>
                  <dd
                    className={`font-medium ${
                      card.availableCents < 0 ? "text-red-600" : "text-emerald-600"
                    }`}
                  >
                    {formatBRL(card.availableCents)}
                  </dd>
                </div>
              </dl>

              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{
                    width: `${Math.min(
                      100,
                      card.limitCents > 0
                        ? ((card.invoiceCents + card.futureInstallmentsCents) /
                            card.limitCents) *
                            100
                        : 0,
                    )}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Vencimento da fatura atual: {new Date(card.invoiceDue).toLocaleDateString("pt-BR")}
              </p>

              <button
                onClick={() => void openInvoice(card)}
                className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
              >
                Ver fatura detalhada
              </button>
            </div>
          ))
        )}
      </div>

      {invoiceCard && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium text-slate-700">
              Fatura de {invoiceCard.name} — {formatBRL(invoiceItems.reduce((s, i) => s + i.amountCents, 0))}
            </h2>
            <button
              onClick={() => setInvoiceCard(null)}
              className="text-sm text-slate-500 hover:underline"
            >
              Fechar
            </button>
          </div>
          {invoiceItems.length === 0 ? (
            <p className="text-sm text-slate-400">Sem compras nesta fatura.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Descrição</th>
                  <th className="px-2 py-2">Categoria</th>
                  <th className="px-2 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {invoiceItems.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-2 py-2 text-slate-500">
                      {new Date(item.date).toLocaleDateString("pt-BR")}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {item.description}
                      {item.installmentNumber && (
                        <span className="ml-1 text-xs text-slate-400">
                          {item.installmentNumber}/{item.installmentTotal}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-500">{item.category?.name ?? "—"}</td>
                    <td className="px-2 py-2 text-right font-medium text-red-600">
                      {formatBRL(item.amountCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
