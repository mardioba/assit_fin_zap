import { interpretationSchema, type Interpretation } from "./ai.schema.js";

/**
 * Interpretador determinístico pt-BR (offline).
 * Usado quando não há chaves de OpenAI/Gemini (dev, testes e ambientes sem IA).
 * Não é "IA", mas segue EXATAMENTE o mesmo contrato — o resto do sistema
 * não sabe qual provedor está ativo.
 */

const MONTHS_PT: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 4, abril: 4, maio: 5, junho: 6,
  julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
};

const EXPENSE_VERBS = ["gastei", "paguei", "comprei", "gastar", "pagar", "despesa"];
const INCOME_VERBS = ["recebi", "ganhei", "lucro", "receita", "entrou", "faturei"];

const STOPWORDS = new Set([
  "gastei", "paguei", "comprei", "recebi", "ganhei", "hoje", "ontem", "reais", "real",
  "hoje,", "r$", "de", "em", "no", "na", "num", "numa", "por", "para", "com", "uma",
  "um", "uns", "umas", "o", "a", "os", "as", "e", "quanto", "foi", "valor", "conta",
  "gasto", "despesa", "receita", "pagamento", "pagamos", "este", "esse", "esta",
  "essa", "mês", "mes", "mensal", "quero", "registrar", "lançar", "anotar", "dia",
  "quando", "quem", "sobre", "total",
]);

function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function today(): Date {
  return new Date();
}

function formatKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function parseAmount(text: string): number | undefined {
  // R$ 1.234,56 | 35,50 | 35 reais | 1200
  const match =
    /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d{1,3}(?:\.\d{3})+|\d+)/i.exec(
      text,
    );
  if (!match) return undefined;
  const normalized = match[1]!.replace(/\.(?=\d{3})/g, "").replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100);
}

function parseDate(text: string): string {
  const now = today();
  const lower = stripAccents(text);
  if (/\bontem\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  // "dia 10", "em 10/11"
  const brDate = /(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/.exec(text);
  if (brDate) {
    const day = Number(brDate[1]);
    const month = Number(brDate[2]);
    const year = brDate[3] ? Number(brDate[3]) : now.getFullYear();
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const dayMatch = /(?:dia\s+|em\s+)(\d{1,2})\b/.exec(lower);
  if (dayMatch) {
    const day = Number(dayMatch[1]);
    if (day >= 1 && day <= 31) {
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return now.toISOString().slice(0, 10);
}

/** Extrai "de combustível" / "no almoço" → descrição. */
function extractDescription(text: string): string | undefined {
  const cleaned = text
    .replace(/(?:r\$\s*)?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+,\d{1,2}|\d+/g, " ")
    .replace(/[.,!?]/g, " ");
  const words = cleaned.split(/\s+/).filter((w) => w && !STOPWORDS.has(stripAccents(w)));
  if (words.length === 0) return undefined;
  // Remove termos residuais comuns no início
  while (words.length > 0 && ["de", "em", "no", "na"].includes(stripAccents(words[0]!))) {
    words.shift();
  }
  const description = words.join(" ").trim();
  return description.length >= 2 ? description : undefined;
}

function detectCategory(
  description: string | undefined,
  type: "INCOME" | "EXPENSE",
): string | undefined {
  if (!description) return undefined;
  const expenseMap: Record<string, string> = {
    combustivel: "Transporte",
    gasolina: "Transporte",
    almoço: "Alimentação",
    almoco: "Alimentação",
    jantar: "Alimentação",
    cafe: "Alimentação",
    mercado: "Alimentação",
    supermercado: "Alimentação",
    ifood: "Alimentação",
    energia: "Moradia",
    luz: "Moradia",
    aluguel: "Moradia",
    internet: "Moradia",
    agua: "Moradia",
    farmacia: "Saúde",
    remedio: "Saúde",
    medico: "Saúde",
    cinema: "Lazer",
    netflix: "Assinaturas",
    spotify: "Assinaturas",
  };
  const incomeMap: Record<string, string> = {
    salario: "Salário",
    servico: "Serviços",
    freela: "Serviços",
    freela2: "Serviços",
    dividendos: "Investimentos",
    investimento: "Investimentos",
    aposentadoria: "Salário",
    pensao: "Salário",
  };
  const map = type === "INCOME" ? incomeMap : expenseMap;
  const normalized = stripAccents(description);
  for (const [key, category] of Object.entries(map)) {
    if (normalized.includes(key)) return category;
  }
  return undefined;
}

function detectMonth(text: string): string | undefined {
  const lower = stripAccents(text);
  const now = today();
  if (/\bm\s+passado\b|\bmes passado\b/.test(lower)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return formatKey(d);
  }
  if (/\besse\s+mes\b|\beste\s+mes\b|\bmes\s+atual\b/.test(lower)) {
    return formatKey(now);
  }
  if (/\bano\s+passado\b/.test(lower)) {
    return `${now.getFullYear() - 1}-12`;
  }
  for (const [name, month] of Object.entries(MONTHS_PT)) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) {
      const yearMatch = /\b(20\d{2})\b/.exec(lower);
      const year = yearMatch ? Number(yearMatch[1]) : now.getFullYear();
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  }
  return undefined;
}

function empty(partial: Partial<Interpretation>): Interpretation {
  return interpretationSchema.parse({
    intent: "unknown",
    ambiguous: false,
    missing: [],
    ...partial,
  });
}

export function interpretMock(text: string, now = new Date()): Interpretation {
  const raw = text.trim();
  const lower = stripAccents(raw);

  if (!raw) return empty({ intent: "unknown" });

  // Saudação / ajuda
  if (/^(oi|ola|olá|opa|bom dia|boa tarde|boa noite|e ai|eai)\b/.test(lower)) {
    return empty({ intent: "greeting" });
  }
  if (/\b(ajuda|comandos|o que voce faz|como funciona|help)\b/.test(lower)) {
    return empty({ intent: "help" });
  }

  // Consultas (antes de criação, pois contêm "quanto")
  if (/\bmaiores\s+gastos\b|\bmaior\s+gasto\b|\btop\s+gastos\b/.test(lower)) {
    return empty({
      intent: "query_top_expenses",
      query: { month: detectMonth(raw) },
    });
  }
  if (/\bquanto\s+(tenho|sobrou|disponivel|pode|posso gastar)\b|\bsaldo\b|\bdisponivel\b/.test(lower)) {
    return empty({ intent: "query_balance" });
  }
  if (/\bquanto\b/.test(lower)) {
    // "quanto gastei com combustível em outubro" -> por categoria
    const category =
      detectCategory(extractCategoryPhrase(raw), "EXPENSE") ?? extractCategoryPhrase(raw);
    const month = detectMonth(raw);
    if (category && month) {
      return empty({
        intent: "query_by_category",
        query: { month, categoryName: category },
      });
    }
    return empty({
      intent: "query_summary",
      query: { month: month ?? formatKey(now) },
    });
  }

  // Criação de movimentação
  const isExpense = EXPENSE_VERBS.some((v) => lower.includes(v));
  const isIncome = INCOME_VERBS.some((v) => lower.includes(v));
  if (isExpense || isIncome) {
    const amountCents = parseAmount(raw);
    const description = extractDescription(raw);
    const type: "INCOME" | "EXPENSE" = isExpense && !isIncome ? "EXPENSE" : "INCOME";
    const missing: string[] = [];
    if (!amountCents) missing.push("valor");
    if (!description) missing.push("descrição");

    return empty({
      intent: "create_transaction",
      transaction: {
        type,
        ...(amountCents ? { amountCents } : {}),
        ...(description ? { description } : {}),
        date: parseDate(raw),
        ...(description && detectCategory(description, type)
          ? { categoryName: detectCategory(description, type)! }
          : {}),
      },
      ambiguous: missing.length > 0,
      missing,
    });
  }

  return empty({ intent: "unknown" });
}

/** Trecho após "com/de ... " para capturar a categoria da consulta. */
function extractCategoryPhrase(text: string): string | undefined {
  const match = /\b(?:com|de|em)\s+(?:o\s+|a\s+)?([\wáéíóúâêôãõç]+(?:\s+[\wáéíóúâêôãõç]+)*)/i.exec(
    text,
  );
  if (!match) return undefined;
  const words = match[1]!.split(/\s+/).filter((w) => !STOPWORDS.has(stripAccents(w)));
  return words.length > 0 ? words.join(" ") : undefined;
}
