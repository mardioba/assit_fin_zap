import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "../lib/api";
import type { Category } from "../lib/types";

const TYPE_LABEL: Record<string, string> = { INCOME: "Receitas", EXPENSE: "Despesas" };

export function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [type, setType] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  const [color, setColor] = useState("#059669");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const { categories: list } = await api<{ categories: Category[] }>("/categories");
      setCategories(list);
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
    try {
      await api("/categories", { method: "POST", body: { name, type, color } });
      setName("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao criar categoria");
    }
  }

  async function handleDelete(c: Category) {
    if (!confirm(`Excluir a categoria "${c.name}"? As movimentações ficarão sem categoria.`))
      return;
    try {
      await api(`/categories/${c.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao excluir");
    }
  }

  async function toggleRename(c: Category) {
    const newName = prompt("Novo nome da categoria:", c.name);
    if (!newName || newName === c.name) return;
    try {
      await api(`/categories/${c.id}`, { method: "PATCH", body: { name: newName } });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao renomear");
    }
  }

  const groups: Array<"EXPENSE" | "INCOME"> = ["EXPENSE", "INCOME"];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Categorias</h1>
        <p className="text-sm text-slate-500">
          {categories.length} categoria(s) — personalizáveis por você
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <form
        onSubmit={handleCreate}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Nome</label>
          <input
            type="text"
            required
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Ex.: Pets"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Tipo</label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "INCOME" | "EXPENSE")}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="EXPENSE">Despesa</option>
            <option value="INCOME">Receita</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Cor</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-16 rounded-md border border-slate-300"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          Adicionar
        </button>
      </form>

      {loading ? (
        <p className="text-slate-400">Carregando…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <div key={group} className="rounded-xl border border-slate-200 bg-white p-4">
              <h2
                className={`mb-3 font-medium ${
                  group === "INCOME" ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {TYPE_LABEL[group]}
              </h2>
              <ul className="space-y-2">
                {categories
                  .filter((c) => c.type === group)
                  .map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2 text-sm"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="inline-block h-3 w-3 rounded-full"
                          style={{ backgroundColor: c.color ?? "#94a3b8" }}
                        />
                        {c.name}
                        {c.isDefault && (
                          <span className="text-xs text-slate-400">padrão</span>
                        )}
                      </span>
                      <span>
                        <button
                          onClick={() => void toggleRename(c)}
                          className="text-emerald-700 hover:underline"
                        >
                          Renomear
                        </button>
                        <button
                          onClick={() => void handleDelete(c)}
                          className="ml-3 text-red-600 hover:underline"
                        >
                          Excluir
                        </button>
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
