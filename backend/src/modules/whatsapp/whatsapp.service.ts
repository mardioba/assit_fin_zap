import { createHmac, timingSafeEqual } from "node:crypto";
import type { User } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { isUniqueViolation } from "../../lib/prisma-errors.js";
import { interpretMessage } from "../ai/ai.js";
import { resolveProvider } from "../ai/ai.js";
import type { Interpretation } from "../ai/ai.schema.js";
import { extractReceipt, resolveMediaProvider, transcribeAudio } from "../ai/media.js";
import { audit } from "../audit/audit.service.js";
import {
  downloadMedia,
  isWhatsAppConfigured,
  normalizePhone,
  sendText,
} from "./whatsapp.client.js";

// ---------- Verificação e assinatura do webhook (Meta) ----------

export function verifyWebhook(query: Record<string, unknown>): string | null {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && token === env.whatsapp.verifyToken && challenge) {
    return String(challenge);
  }
  return null;
}

/** HMAC-SHA256 do corpo bruto com o app secret (X-Hub-Signature-256). */
export function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!env.whatsapp.appSecret) return true; // secreto não configurado (dev)
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env.whatsapp.appSecret)
    .update(rawBody)
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

// ---------- Payload do webhook ----------

export type IncomingMessage = {
  id: string;
  from: string;
  type: string;
  text?: string;
  /** ID da mídia no servidor da Meta (áudio/foto) — Fase 4. */
  mediaId?: string;
  mime?: string;
  /** Legenda da imagem (quando presente). */
  caption?: string;
};

export function parseWebhookPayload(payload: unknown): IncomingMessage[] {
  if (!payload || typeof payload !== "object") return [];
  const p = payload as Record<string, unknown>;
  if (p.object !== "whatsapp_business_account") return [];

  const messages: IncomingMessage[] = [];
  const entries = Array.isArray(p.entry) ? p.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray((entry as Record<string, unknown>).changes)
      ? ((entry as Record<string, unknown>).changes as Record<string, unknown>[])
      : [];
    for (const change of changes) {
      const value = (change.value ?? {}) as Record<string, unknown>;
      const msgs = Array.isArray(value.messages) ? value.messages : [];
      for (const msg of msgs) {
        const m = msg as Record<string, unknown>;
        const id = typeof m.id === "string" ? m.id : "";
        const from = typeof m.from === "string" ? m.from : "";
        const type = typeof m.type === "string" ? m.type : "";
        if (!id || !from) continue;
        let text: string | undefined;
        let mediaId: string | undefined;
        let mime: string | undefined;
        let caption: string | undefined;
        if (type === "text") {
          const t = m.text as Record<string, unknown> | undefined;
          text = typeof t?.body === "string" ? t.body : undefined;
        } else if (type === "audio" || type === "image" || type === "video" || type === "document") {
          const media = m[type] as Record<string, unknown> | undefined;
          if (media) {
            if (typeof media.id === "string") mediaId = media.id;
            if (typeof media.mime_type === "string") mime = media.mime_type;
            if (typeof media.caption === "string") caption = media.caption;
          }
        }
        messages.push({ id, from, type, text, mediaId, mime, caption });
      }
    }
  }
  return messages;
}

// ---------- Processamento principal ----------

const SIM = /^(sim|s|pode|isso|confirmar|confirma|confirmado|certo|ok)$/i;
const NAO = /^(não|nao|n|cancelar|desisto|cancela)$/i;

type PendingTransaction = {
  kind: "confirm" | "fill";
  missing?: string[];
  transaction: {
    type: "INCOME" | "EXPENSE";
    amountCents?: number;
    description?: string;
    date?: string;
    categoryName?: string;
    paymentMethod?: string | null;
    establishment?: string | null;
  };
};

function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return `${date.toLocaleDateString("pt-BR", { month: "long" })} de ${y}`;
}

async function resolveUserIdByPhone(from: string): Promise<User | null> {
  const phone = normalizePhone(from);
  return prisma.user.findFirst({
    where: { whatsappPhone: phone, isActive: true },
  });
}

/** Categoria por nome (case/acento-insensível); cria se não existir. */
async function resolveCategory(
  userId: string,
  name: string | undefined,
  type: "INCOME" | "EXPENSE",
): Promise<{ id: string; name: string } | null> {
  if (!name || !name.trim()) return null;
  const normalize = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

  const categories = await prisma.category.findMany({
    where: { userId, type },
    select: { id: true, name: true },
  });
  const target = normalize(name);
  const exact = categories.find((c) => normalize(c.name) === target);
  if (exact) return exact;
  const loose = categories.find(
    (c) =>
      normalize(c.name).includes(target) || target.includes(normalize(c.name)),
  );
  if (loose) return loose;

  const pretty = name.trim().replace(/^./, (c) => c.toUpperCase());
  const created = await prisma.category.create({
    data: { userId, name: pretty, type },
  });
  return { id: created.id, name: created.name };
}

async function persistTransaction(
  user: User,
  tx: PendingTransaction["transaction"],
): Promise<string> {
  if (!tx.amountCents || tx.amountCents <= 0) {
    throw new Error("Valor inválido para a movimentação");
  }
  const type = tx.type;
  const category = await resolveCategory(user.id, tx.categoryName, type);

  const transaction = await prisma.transaction.create({
    data: {
      userId: user.id,
      type,
      amountCents: tx.amountCents,
      description: tx.description?.trim() || "Sem descrição",
      date: tx.date ? new Date(`${tx.date}T12:00:00`) : new Date(),
      categoryId: category?.id ?? null,
      paymentMethod: (tx.paymentMethod as string | null) ?? null,
      establishment: tx.establishment ?? null,
    },
  });
  await audit({
    userId: user.id,
    action: "whatsapp.transaction.create",
    entityType: "transaction",
    entityId: transaction.id,
    metadata: { via: "whatsapp", type, amountCents: tx.amountCents },
  });

  const label = type === "EXPENSE" ? "Despesa" : "Receita";
  return `${label} de ${formatBRL(tx.amountCents)} registrada${
    category ? ` na categoria ${category.name}` : ""
  }.`;
}

// ---------- Respostas de consulta (sempre dados REAIS do banco) ----------

async function replyQuery(
  user: User,
  interp: Interpretation,
): Promise<string> {
  const monthKey =
    interp.query?.month ?? new Date().toISOString().slice(0, 7);
  const [y, m] = monthKey.split("-");
  const start = new Date(Number(y), Number(m) - 1, 1);
  const end = new Date(Number(y), Number(m), 1);

  const grouped = await prisma.transaction.groupBy({
    by: ["type"],
    where: { userId: user.id, date: { gte: start, lt: end } },
    _sum: { amountCents: true },
  });
  const income = grouped.find((g) => g.type === "INCOME")?._sum.amountCents ?? 0;
  const expense = grouped.find((g) => g.type === "EXPENSE")?._sum.amountCents ?? 0;

  switch (interp.intent) {
    case "query_summary":
      return (
        `Em ${monthLabel(monthKey)} você recebeu ${formatBRL(income)} ` +
        `e gastou ${formatBRL(expense)}. ` +
        `Resultado do mês: ${formatBRL(income - expense)}.`
      );

    case "query_balance": {
      const accounts = await prisma.account.findMany({
        where: { userId: user.id },
        select: { initialBalanceCents: true },
      });
      const allTime = await prisma.transaction.groupBy({
        by: ["type"],
        where: { userId: user.id },
        _sum: { amountCents: true },
      });
      const inAll = allTime.find((g) => g.type === "INCOME")?._sum.amountCents ?? 0;
      const outAll = allTime.find((g) => g.type === "EXPENSE")?._sum.amountCents ?? 0;
      const initial = accounts.reduce((s, a) => s + a.initialBalanceCents, 0);
      const balance = initial + inAll - outAll;
      return `Seu saldo atual é ${formatBRL(balance)}.`;
    }

    case "query_by_category": {
      const term = interp.query?.categoryName ?? "";
      const categories = await prisma.category.findMany({
        where: { userId: user.id },
        select: { id: true, name: true, type: true },
      });
      const norm = (s: string) =>
        s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
      const match =
        categories.find((c) => norm(c.name) === norm(term)) ??
        categories.find(
          (c) => norm(c.name).includes(norm(term)) || norm(term).includes(norm(c.name)),
        );

      if (match) {
        const total = await prisma.transaction.aggregate({
          where: {
            userId: user.id,
            categoryId: match.id,
            date: { gte: start, lt: end },
          },
          _sum: { amountCents: true },
          _count: true,
        });
        const totalCents = total._sum.amountCents ?? 0;
        if (totalCents === 0) {
          return `Não encontrei movimentações com "${match.name}" em ${monthLabel(monthKey)}.`;
        }
        const verb = match.type === "EXPENSE" ? "gastou" : "recebeu";
        return `Você ${verb} ${formatBRL(totalCents)} com ${match.name} em ${monthLabel(monthKey)} (${total._count} lançamento(s)).`;
      }

      // Sem categoria correspondente: busca na descrição (honesto, sem inventar).
      const byDescription = await prisma.transaction.aggregate({
        where: {
          userId: user.id,
          description: { contains: term },
          date: { gte: start, lt: end },
        },
        _sum: { amountCents: true },
        _count: true,
      });
      const descTotal = byDescription._sum.amountCents ?? 0;
      if (descTotal === 0) {
        return `Não encontrei movimentações com "${term}" em ${monthLabel(monthKey)}.`;
      }
      return `Você gastou ${formatBRL(descTotal)} com "${term}" em ${monthLabel(monthKey)} (${byDescription._count} lançamento(s)).`;
    }

    case "query_top_expenses": {
      const byCategory = await prisma.transaction.groupBy({
        by: ["categoryId"],
        where: {
          userId: user.id,
          type: "EXPENSE",
          date: { gte: start, lt: end },
        },
        _sum: { amountCents: true },
      });
      const ids = byCategory
        .map((g) => g.categoryId)
        .filter((id): id is string => !!id);
      const cats = await prisma.category.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      const catMap = new Map(cats.map((c) => [c.id, c.name]));

      const ranked = byCategory
        .map((g) => ({
          name: g.categoryId ? (catMap.get(g.categoryId) ?? "Outros") : "Sem categoria",
          total: g._sum.amountCents ?? 0,
        }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);

      if (ranked.length === 0) {
        return `Você não teve despesas em ${monthLabel(monthKey)}.`;
      }
      const lines = ranked.map((r, i) => `${i + 1}. ${r.name}: ${formatBRL(r.total)}`);
      return `Maiores despesas de ${monthLabel(monthKey)}:\n${lines.join("\n")}`;
    }

    default:
      return "Não entendi a consulta.";
  }
}

// ---------- Fluxo de interpretação ----------

async function handleInterpretation(
  user: User,
  interp: Interpretation,
): Promise<void> {
  const reply = (body: string) => sendText(normalizePhone(user.whatsappPhone ?? ""), body);

  switch (interp.intent) {
    case "greeting":
      await reply(
        `Olá, ${user.name.split(" ")[0]}! 👋\n` +
          `Me envie suas movimentações, por exemplo:\n` +
          `• "Gastei 35 reais de combustível"\n` +
          `• "Recebi 250 reais de um serviço"\n` +
          `• "Quanto gastei esse mês?"\n` +
          `• "Quanto tenho disponível?"`,
      );
      return;

    case "help":
      await reply(
        "Comandos:\n" +
          "• Registrar: \"Gastei 45 reais no almoço\"\n" +
          "• Saldo: \"Quanto tenho disponível?\"\n" +
          "• Mês: \"Quanto gastei esse mês?\"\n" +
          "• Categoria: \"Quanto gastei com transporte em outubro?\"\n" +
          "• Ranking: \"Quais são meus maiores gastos?\"",
      );
      return;

    case "query_summary":
    case "query_balance":
    case "query_by_category":
    case "query_top_expenses":
      await reply(await replyQuery(user, interp));
      return;

    case "create_transaction": {
      const rawTx = interp.transaction;
      if (!rawTx || !rawTx.type) {
        await reply("Não consegui identificar os dados. Tente: \"Gastei 35 reais de combustível\".");
        return;
      }
      const tx: PendingTransaction["transaction"] = {
        ...rawTx,
        type: rawTx.type,
        paymentMethod: rawTx.paymentMethod ?? null,
        establishment: rawTx.establishment ?? null,
      };

      const missing = interp.missing.filter((f) => f === "valor" || f === "descrição");

      // Faltam dados essenciais -> pede o complemento (nunca grava incompleto).
      if (missing.length > 0) {
        const what = missing.join(" e ");
        await prisma.conversationState.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            pendingJson: JSON.stringify({ kind: "fill", missing, transaction: tx } satisfies PendingTransaction),
          },
          update: {
            pendingJson: JSON.stringify({ kind: "fill", missing, transaction: tx } satisfies PendingTransaction),
          },
        });
        if (missing.includes("valor")) {
          await reply(
            `Quanto foi o valor da ${tx.type === "EXPENSE" ? "despesa" : "receita"}${
              tx.description ? ` de "${tx.description}"` : ""
            }?`,
          );
        } else {
          await reply("Qual foi a descrição/categoria da movimentação?");
        }
        return;
      }

      // Interpretado como ambíguo pela IA -> confirma antes de gravar (item 3).
      if (interp.ambiguous) {
        await prisma.conversationState.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            pendingJson: JSON.stringify({ kind: "confirm", transaction: tx } satisfies PendingTransaction),
          },
          update: {
            pendingJson: JSON.stringify({ kind: "confirm", transaction: tx } satisfies PendingTransaction),
          },
        });
        await reply(
          `Confirma ${tx.type === "EXPENSE" ? "despesa" : "receita"} de ${formatBRL(
            tx.amountCents ?? 0,
          )}${tx.description ? ` em "${tx.description}"` : ""}? Responda *sim* ou *não*.`,
        );
        return;
      }

      // Dados completos -> registra e confirma (ex.: "Despesa de R$ 50,00 ...").
      const confirmation = await persistTransaction(user, tx);
      await reply(`✅ ${confirmation}`);
      return;
    }

    default:
      await reply(
        "Não entendi sua mensagem. 🤔\n" +
          'Tente: "Gastei 35 reais de combustível" ou "Quanto gastei esse mês?"',
      );
  }
}

async function handlePending(
  user: User,
  text: string,
  pending: PendingTransaction,
): Promise<boolean> {
  const normalized = text.trim();
  const clearState = () =>
    prisma.conversationState.deleteMany({ where: { userId: user.id } });

  if (pending.kind === "confirm") {
    if (SIM.test(normalized)) {
      await clearState();
      const confirmation = await persistTransaction(user, pending.transaction);
      await sendText(normalizePhone(user.whatsappPhone ?? ""), `✅ ${confirmation}`);
      return true;
    }
    if (NAO.test(normalized)) {
      await clearState();
      await sendText(
        normalizePhone(user.whatsappPhone ?? ""),
        "Cancelado. Envie a movimentação novamente quando quiser.",
      );
      return true;
    }
    return false; // resposta não é confirmação -> reinterpreta como nova mensagem
  }

  // kind === "fill": espera o dado que falta (ex.: apenas um valor).
  const missing = pending.missing ?? ["valor"];
  if (missing.includes("valor")) {
    const match = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+,\d{1,2}|\d+,\d{1,2}|\d+)/.exec(normalized);
    const onlyNumber = /^[\d.,\s r$]+$/.test(normalized);
    if (match && onlyNumber) {
      const amountCents = Math.round(
        Number(match[1]!.replace(/\.(?=\d{3})/g, "").replace(",", ".")) * 100,
      );
      const merged: PendingTransaction = {
        ...pending,
        missing: missing.filter((f) => f !== "valor"),
        transaction: { ...pending.transaction, amountCents },
      };
      const stillMissing = merged.missing ?? [];
      if (stillMissing.length === 0) {
        await clearState();
        const confirmation = await persistTransaction(user, merged.transaction);
        await sendText(normalizePhone(user.whatsappPhone ?? ""), `✅ ${confirmation}`);
        return true;
      }
      await prisma.conversationState.update({
        where: { userId: user.id },
        data: { pendingJson: JSON.stringify(merged) },
      });
      await sendText(
        normalizePhone(user.whatsappPhone ?? ""),
        "Qual foi a descrição/categoria da movimentação?",
      );
      return true;
    }
  }

  if (missing.includes("descrição") || missing.includes("descricao")) {
    // Qualquer texto com letras serve como descrição.
    if (/[a-zA-ZáéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]{2,}/.test(normalized)) {
      const merged: PendingTransaction = {
        ...pending,
        missing: [],
        transaction: {
          ...pending.transaction,
          description: normalized.replace(/[.!?]+$/, ""),
        },
      };
      if (merged.transaction.amountCents) {
        await clearState();
        const confirmation = await persistTransaction(user, merged.transaction);
        await sendText(normalizePhone(user.whatsappPhone ?? ""), `✅ ${confirmation}`);
        return true;
      }
      await prisma.conversationState.update({
        where: { userId: user.id },
        data: { pendingJson: JSON.stringify(merged) },
      });
      await sendText(normalizePhone(user.whatsappPhone ?? ""), "Quanto foi o valor?");
      return true;
    }
  }

  return false; // não completou -> reinterpreta
}

/** Processa uma mensagem de texto já associada a um usuário. */
async function processTextForUser(user: User, text: string): Promise<void> {
  const state = await prisma.conversationState.findUnique({
    where: { userId: user.id },
  });

  if (state) {
    let pending: PendingTransaction | null = null;
    try {
      pending = JSON.parse(state.pendingJson) as PendingTransaction;
    } catch {
      pending = null;
    }
    if (pending && (await handlePending(user, text, pending))) return;
    // Sem pendência resolvida: descarta estado antigo e reinterpreta.
    await prisma.conversationState.deleteMany({ where: { userId: user.id } });
  }

  let interp: Interpretation;
  try {
    interp = await interpretMessage(text);
  } catch (err) {
    console.error("[whatsapp] falha ao interpretar:", err);
    await sendText(
      normalizePhone(user.whatsappPhone ?? ""),
      "Desculpe, não consegui processar sua mensagem agora. Tente novamente.",
    );
    return;
  }
  await handleInterpretation(user, interp);
}

/**
 * Ponto de entrada do webhook: deduplica, associa ao usuário e despacha.
 * Retorna o resultado para fins de teste/observabilidade.
 */
export async function processIncomingMessage(
  msg: IncomingMessage,
): Promise<{ status: string }> {
  // Proteção contra duplicidade (item 8) — wamid como PK.
  try {
    await prisma.processedMessage.create({ data: { id: msg.id } });
  } catch (err) {
    if (isUniqueViolation(err)) return { status: "duplicate" };
    throw err;
  }

  const user = await resolveUserIdByPhone(msg.from);
  if (!user) {
    await sendText(
      normalizePhone(msg.from),
      "⚠️ Este número não está vinculado a nenhuma conta.\n" +
        "Acesse o painel web, faça login e cadastre este número em " +
        "Usuário → WhatsApp para começar a usar.",
    );
    return { status: "unlinked" };
  }

  await prisma.processedMessage.update({
    where: { id: msg.id },
    data: { userId: user.id },
  });

  if (msg.type === "audio") {
    return handleAudio(user, msg);
  }

  if (msg.type === "image") {
    return handleImage(user, msg);
  }

  if (msg.type !== "text" || !msg.text) {
    const kind =
      msg.type === "video" ? "vídeo" : msg.type === "document" ? "documento" : "mídia";
    await sendText(
      normalizePhone(user.whatsappPhone ?? ""),
      `Recebi seu ${kind}, mas não processamos esse tipo. 📎 Envie áudio, foto de ` +
        `comprovante ou os dados em texto: "Gastei 35 reais de combustível".`,
    );
    return { status: "unsupported_media" };
  }

  await processTextForUser(user, msg.text);
  return { status: "processed" };
}

/** Resposta honesta quando não há provedor de mídia/credenciais configurados. */
async function replyMediaUnavailable(
  user: User,
  kind: "áudio" | "comprovante",
): Promise<{ status: string }> {
  await sendText(
    normalizePhone(user.whatsappPhone ?? ""),
    `Recebi seu ${kind}. 📎 A leitura automática precisa de credenciais no ` +
      `servidor (WhatsApp + OPENAI_API_KEY ou GEMINI_API_KEY). Enquanto isso, ` +
      `envie os dados em texto: "Gastei 35 reais de combustível".`,
  );
  return { status: "media_unavailable" };
}

/** Áudio → transcrição → mesmo fluxo de texto (interpretação/consulta). */
async function handleAudio(user: User, msg: IncomingMessage): Promise<{ status: string }> {
  if (!msg.mediaId || resolveMediaProvider() === "none" || !isWhatsAppConfigured()) {
    return replyMediaUnavailable(user, "áudio");
  }
  try {
    const { buffer, mime } = await downloadMedia(msg.mediaId);
    const transcript = (await transcribeAudio(buffer, mime)).trim();
    if (!transcript) {
      await sendText(
        normalizePhone(user.whatsappPhone ?? ""),
        "Não consegui transcrever o áudio. 🎤 Tente falar mais perto do celular ou envie em texto.",
      );
      return { status: "audio_empty" };
    }
    await processTextForUser(user, transcript);
    return { status: "processed" };
  } catch (err) {
    console.error("[whatsapp] falha ao processar áudio:", err);
    await sendText(
      normalizePhone(user.whatsappPhone ?? ""),
      "Desculpe, não consegui processar seu áudio agora. Envie os dados em texto.",
    );
    return { status: "audio_error" };
  }
}

/**
 * Foto de comprovante → leitura (OCR/visão) → mesma máquina de estados do
 * texto: se vier completa, pede confirmação (item 3); se faltar valor, pede.
 * Nunca grava sem passar por confirmação.
 */
async function handleImage(user: User, msg: IncomingMessage): Promise<{ status: string }> {
  if (!msg.mediaId || resolveMediaProvider() === "none" || !isWhatsAppConfigured()) {
    return replyMediaUnavailable(user, "comprovante");
  }
  try {
    const { buffer, mime } = await downloadMedia(msg.mediaId);
    const interp = await extractReceipt(
      buffer,
      mime,
      new Date().toISOString().slice(0, 10),
    );

    if (interp.intent !== "create_transaction" || !interp.transaction?.type) {
      await sendText(
        normalizePhone(user.whatsappPhone ?? ""),
        "Li a foto, mas não consegui identificar uma movimentação. 🧾 Envie os dados em texto: " +
          '"Gastei 35 reais de combustível".',
      );
      return { status: "image_unreadable" };
    }

    // Força o fluxo de confirmação/complemento — idêntico ao texto ambíguo.
    await handleInterpretation(user, { ...interp, ambiguous: true });
    return { status: "processed" };
  } catch (err) {
    console.error("[whatsapp] falha ao ler comprovante:", err);
    await sendText(
      normalizePhone(user.whatsappPhone ?? ""),
      "Desculpe, não consegui ler o comprovante agora. Envie os dados em texto.",
    );
    return { status: "image_error" };
  }
}

/** Processa o payload completo do webhook. */
export async function handleWebhookPayload(
  payload: unknown,
): Promise<{ processed: number; results: string[] }> {
  const messages = parseWebhookPayload(payload);
  const results: string[] = [];
  for (const msg of messages) {
    const { status } = await processIncomingMessage(msg);
    results.push(status);
  }
  return { processed: messages.length, results };
}

export { resolveProvider };
