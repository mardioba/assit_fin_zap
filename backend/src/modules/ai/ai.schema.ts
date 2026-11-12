import { z } from "zod";

/**
 * Contrato único de interpretação — TODOS os provedores (mock, OpenAI,
 * Gemini) devem retornar exatamente este formato. O servidor valida com Zod
 * antes de usar: a IA NUNCA grava dados sem passar por esta validação.
 */
export const interpretationSchema = z.object({
  intent: z.enum([
    "create_transaction",
    "query_summary",
    "query_balance",
    "query_by_category",
    "query_top_expenses",
    "greeting",
    "help",
    "unknown",
  ]),
  transaction: z
    .object({
      type: z.enum(["INCOME", "EXPENSE"]).optional(),
      amountCents: z.number().int().positive().optional(),
      description: z.string().max(160).optional(),
      // YYYY-MM-DD
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      categoryName: z.string().max(60).optional(),
      paymentMethod: z
        .enum(["PIX", "CASH", "CREDIT", "DEBIT", "TRANSFER", "OTHER"])
        .optional(),
      establishment: z.string().max(120).optional(),
    })
    .optional(),
  query: z
    .object({
      // YYYY-MM
      month: z
        .string()
        .regex(/^\d{4}-\d{2}$/)
        .optional(),
      categoryName: z.string().max(60).optional(),
    })
    .optional(),
  // true quando faltam dados essenciais -> servidor pede confirmação/complemento
  ambiguous: z.boolean().default(false),
  missing: z.array(z.string().max(40)).default([]),
});

export type Interpretation = z.infer<typeof interpretationSchema>;

export const SYSTEM_PROMPT = `Você é o interpretador de mensagens de um assistente financeiro em português do Brasil.
Analise a mensagem do usuário e retorne APENAS um JSON válido com este formato:
{
  "intent": "create_transaction" | "query_summary" | "query_balance" | "query_by_category" | "query_top_expenses" | "greeting" | "help" | "unknown",
  "transaction": { "type": "INCOME" | "EXPENSE", "amountCents": <inteiro em centavos>, "description": "<texto>", "date": "<YYYY-MM-DD>", "categoryName": "<categoria sugerida>", "paymentMethod": "PIX" | "CASH" | "CREDIT" | "DEBIT" | "TRANSFER" | "OTHER", "establishment": "<estabelecimento>" },
  "query": { "month": "<YYYY-MM>", "categoryName": "<categoria>" },
  "ambiguous": <true|false>,
  "missing": ["campo que falta"]
}
Regras:
- amountCents SEMPRE em centavos (R$ 35,50 = 3550).
- date usa o valor de HOJE informado no contexto quando não houver data explícita.
- Para perguntas ("quanto gastei", "quanto tenho", "maiores gastos") use intent de query e NÃO invente valores.
- Sempre inclua "transaction" quando intent=create_transaction.
- Se faltar valor ou descrição essencial, marque "ambiguous": true e coloque em "missing".`;
