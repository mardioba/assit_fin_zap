// Utilitários de dinheiro.
// DECISÃO TÉCNICA: valores financeiros são armazenados em CENTAVOS (Int)
// para evitar erros de ponto flutuante (ex.: 0.1 + 0.2) e permitir somas
// exatas no banco (compatível com SQLite e PostgreSQL).

/** Converte "35.50" | "R$ 35,50" | 35.5 para 3550 centavos. */
export function toCents(value: string | number): number {
  const raw =
    typeof value === "number"
      ? String(value)
      : value
          .replace(/[^\d,.-]/g, "")
          .replace(/\.(?=\d{3}\b)/g, "")
          .replace(",", ".");
  if (raw === "" || raw === "-" || raw === "." || raw === ",") {
    throw new Error(`Valor monetário inválido: ${String(value)}`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Valor monetário inválido: ${String(value)}`);
  }
  return Math.round(parsed * 100);
}

/** Converte 3550 centavos para "R$ 35,50". */
export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
