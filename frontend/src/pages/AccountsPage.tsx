import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import { formatBRL, toCents, type Account } from "../lib/types";

const TYPE_LABEL: Record<string, string> = {
  BANK: "Conta bancária",
  CASH: "Dinheiro em espécie",
  WALLET: "Carteira digital",
};

const EMPTY_ACCOUNT = { name: "", type: "BANK", initialBalance: "0,00" };
const EMPTY_TRANSFER = { fromAccountId: "", toAccountId: "", amount: "", description: "" };

export function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountForm, setAccountForm] = useState(EMPTY_ACCOUNT);
  const [transferForm, setTransferForm] = useState(EMPTY_TRANSFER);
  const [showTransfer, setShowTransfer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { accounts: list } = await api<{ accounts: Account[] }>("/accounts");
      setAccounts(list);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api("/accounts", {
        method: "POST",
        body: {
          name: accountForm.name,
          type: accountForm.type,
          initialBalanceCents: toCents(accountForm.initialBalance),
        },
      });
      setAccountForm(EMPTY_ACCOUNT);
      setMessage("Conta criada com sucesso.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar conta");
    }
  }

  async function handleTransfer(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api("/accounts/transfer", {
        method: "POST",
        body: {
          fromAccountId: transferForm.fromAccountId,
          toAccountId: transferForm.toAccountId,
          amountCents: toCents(transferForm.amount),
          description: transferForm.description || undefined,
          date: new Date().toISOString(),
        },
      });
      setTransferForm(EMPTY_TRANSFER);
      setShowTransfer(false);
      setMessage("Transferência realizada.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha na transferência");
    }
  }

  async function handleDelete(a: Account) {
    if (!confirm(`Excluir a conta "${a.name}"?`)) return;
    try {
      await api(`/accounts/${a.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao excluir");
    }
  }

  const totalCents = accounts.reduce((s, a) => s + a.balanceCents, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Contas</h1>
          <p className="text-sm text-slate-500">Saldo total: {formatBRL(totalCents)}</p>
        </div>
        <button
          onClick={() => setShowTransfer(!showTransfer)}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          {showTransfer ? "Cancelar" : "⇄ Transferir entre contas"}
        </button>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}
      {message && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
      )}

      {showTransfer && (
        <form
          onSubmit={handleTransfer}
          className="rounded-xl border border-slate-200 bg-white p-4"
        >
          <h2 className="mb-3 font-medium text-slate-700">Transferência entre contas</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select
              required
              value={transferForm.fromAccountId}
              onChange={(e) => setTransferForm({ ...transferForm, fromAccountId: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">De (origem)…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select
              required
              value={transferForm.toAccountId}
              onChange={(e) => setTransferForm({ ...transferForm, toAccountId: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="">Para (destino)…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              required
              inputMode="decimal"
              placeholder="Valor (R$)"
              value={transferForm.amount}
              onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              maxLength={160}
              placeholder="Descrição (opcional)"
              value={transferForm.description}
              onChange={(e) => setTransferForm({ ...transferForm, description: e.target.value })}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="mt-3 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
          >
            Transferir
          </button>
        </form>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="mb-3 font-medium text-slate-700">Suas contas</h2>
          {loading ? (
            <p className="text-slate-400">Carregando…</p>
          ) : accounts.length === 0 ? (
            <p className="text-sm text-slate-400">
              Nenhuma conta cadastrada ainda. Crie a primeira ao lado.
            </p>
          ) : (
            <ul className="space-y-2">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-3"
                >
                  <div>
                    <p className="font-medium text-slate-700">{a.name}</p>
                    <p className="text-xs text-slate-500">{TYPE_LABEL[a.type]}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span
                      className={`font-semibold ${
                        a.balanceCents < 0 ? "text-red-600" : "text-slate-800"
                      }`}
                    >
                      {formatBRL(a.balanceCents)}
                    </span>
                    <button
                      onClick={() => void handleDelete(a)}
                      className="text-red-600 hover:underline"
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-slate-700">Nova conta</h2>
          <div className="space-y-3">
            <input
              type="text"
              required
              maxLength={80}
              placeholder="Nome (ex.: Banco Itaú)"
              value={accountForm.name}
              onChange={(e) => setAccountForm({ ...accountForm, name: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={accountForm.type}
              onChange={(e) => setAccountForm({ ...accountForm, type: e.target.value })}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="BANK">Conta bancária</option>
              <option value="CASH">Dinheiro em espécie</option>
              <option value="WALLET">Carteira digital</option>
            </select>
            <input
              type="text"
              inputMode="decimal"
              placeholder="Saldo inicial (R$)"
              value={accountForm.initialBalance}
              onChange={(e) =>
                setAccountForm({ ...accountForm, initialBalance: e.target.value })
              }
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="w-full rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            >
              Criar conta
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
