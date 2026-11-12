import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { conflict, notFound } from "../../lib/errors.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { paramId } from "../../lib/params.js";
import { audit } from "../audit/audit.service.js";
import { sendText, normalizePhone } from "../whatsapp/whatsapp.client.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const billsRouter = Router();
billsRouter.use(requireAuth);

const createSchema = z.object({
  type: z.enum(["PAYABLE", "RECEIVABLE"]),
  description: z.string().min(1).max(160),
  amountCents: z.number().int().positive().max(100_000_000_00),
  dueDate: z.coerce.date(),
  categoryId: z.string().nullish(),
  accountId: z.string().nullish(),
});

const updateSchema = createSchema.partial();

function uid(req: Parameters<typeof requireAuth>[0]): string {
  return (req as AuthedRequest).user!.sub;
}

function startOfToday(now = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Status derivado: PAID/RECEIVED se pago; senão OVERDUE se venceu; senão OPEN.
 * Não existe "OVERDUE" no banco — é calculado (nunca dessincroniza).
 */
export function billStatus(
  bill: { type: string; paidAt: Date | null; dueDate: Date },
  now = new Date(),
): "OPEN" | "OVERDUE" | "PAID" | "RECEIVED" {
  if (bill.paidAt) return bill.type === "PAYABLE" ? "PAID" : "RECEIVED";
  return bill.dueDate < startOfToday(now) ? "OVERDUE" : "OPEN";
}

async function assertOwnership(
  userId: string,
  ids: { categoryId?: string | null; accountId?: string | null },
): Promise<void> {
  if (ids.categoryId) {
    const c = await prisma.category.findFirst({ where: { id: ids.categoryId, userId } });
    if (!c) throw notFound("Categoria não encontrada");
  }
  if (ids.accountId) {
    const a = await prisma.account.findFirst({ where: { id: ids.accountId, userId } });
    if (!a) throw notFound("Conta não encontrada");
  }
}

billsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const q = z
      .object({
        type: z.enum(["PAYABLE", "RECEIVABLE"]).optional(),
        status: z.enum(["OPEN", "OVERDUE", "PAID", "RECEIVED", "ALL"]).default("ALL"),
        month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      })
      .parse(req.query);

    const now = new Date();
    const where = {
      userId,
      ...(q.type ? { type: q.type } : {}),
      ...(q.month
        ? (() => {
            const [y, m] = q.month.split("-").map(Number);
            return {
              dueDate: {
                gte: new Date(y!, m! - 1, 1),
                lt: new Date(y!, m!, 1),
              },
            };
          })()
        : {}),
    };

    const bills = await prisma.bill.findMany({ where, orderBy: { dueDate: "asc" } });
    const withStatus = bills.map((b) => ({ ...b, status: billStatus(b, now) }));
    const filtered =
      q.status === "ALL" ? withStatus : withStatus.filter((b) => b.status === q.status);

    res.json({
      bills: filtered,
      overdueCount: withStatus.filter((b) => b.status === "OVERDUE").length,
      openCount: withStatus.filter((b) => b.status === "OPEN").length,
    });
  }),
);

billsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = createSchema.parse(req.body);
    await assertOwnership(userId, data);
    const bill = await prisma.bill.create({
      data: { ...data, userId, categoryId: data.categoryId ?? null, accountId: data.accountId ?? null },
    });
    await audit({ userId, action: "bill.create", entityType: "bill", entityId: bill.id, metadata: { type: bill.type, amountCents: bill.amountCents }, req });
    res.status(201).json({ bill: { ...bill, status: billStatus(bill) } });
  }),
);

billsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = updateSchema.parse(req.body);
    const existing = await prisma.bill.findFirst({
      where: { id: paramId(req, "Conta"), userId },
    });
    if (!existing) throw notFound("Conta não encontrada");
    await assertOwnership(userId, data);

    const bill = await prisma.bill.update({
      where: { id: existing.id },
      data: {
        ...data,
        // Mudou o vencimento? Reinicia o aviso para não perder o lembrete.
        ...(data.dueDate && data.dueDate.getTime() !== existing.dueDate.getTime()
          ? { remindedAt: null }
          : {}),
      },
    });
    await audit({ userId, action: "bill.update", entityType: "bill", entityId: bill.id, req });
    res.json({ bill: { ...bill, status: billStatus(bill) } });
  }),
);

/** Marca como paga/recebida (ou desfaz com unpay). */
billsRouter.post(
  "/:id/pay",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const existing = await prisma.bill.findFirst({
      where: { id: paramId(req, "Conta"), userId },
    });
    if (!existing) throw notFound("Conta não encontrada");
    const body = z.object({ undo: z.boolean().optional() }).parse(req.body ?? {});
    const bill = await prisma.bill.update({
      where: { id: existing.id },
      data: { paidAt: body.undo ? null : new Date() },
    });
    await audit({ userId, action: body.undo ? "bill.unpay" : "bill.pay", entityType: "bill", entityId: bill.id, req });
    res.json({ bill: { ...bill, status: billStatus(bill) } });
  }),
);

billsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const existing = await prisma.bill.findFirst({
      where: { id: paramId(req, "Conta"), userId },
    });
    if (!existing) throw notFound("Conta não encontrada");
    await prisma.bill.delete({ where: { id: existing.id } });
    await audit({ userId, action: "bill.delete", entityType: "bill", entityId: existing.id, req });
    res.json({ ok: true });
  }),
);

/**
 * Lembretes via WhatsApp (Fase 4): conta vence amanhã ou está atrasada,
 * enviados UMA vez por conta (anti-spam via remindedAt).
 * Chamado pela API (endpoint /run) e pelo agendador diário em produção.
 */
export async function runBillReminders(now = new Date()): Promise<number> {
  // Janela: vence hoje, ontem ou amanhã (qualquer hora do dia do vencimento).
  const todayStart = startOfToday(now);
  const startOfAfterTomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 2,
  );
  const startOfTomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  );
  const candidates = await prisma.bill.findMany({
    where: { paidAt: null, remindedAt: null, dueDate: { lt: startOfAfterTomorrow } },
    include: { user: { select: { whatsappPhone: true, name: true } } },
  });

  let sent = 0;
  for (const bill of candidates) {
    if (!bill.user.whatsappPhone) continue;

    const isOverdue = bill.dueDate < todayStart;
    const label = bill.type === "PAYABLE" ? "a pagar" : "a receber";
    const value = (bill.amountCents / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    const due = bill.dueDate.toLocaleDateString("pt-BR");
    const isTomorrow =
      bill.dueDate >= startOfTomorrow && bill.dueDate < startOfAfterTomorrow;
    const message = isOverdue
      ? `🔴 ATRASADA: "${bill.description}" (${label}) de ${value} vencia em ${due}. Regularize pelo painel.`
      : `🔔 Lembrete: "${bill.description}" (${label}) de ${value} vence ${isTomorrow ? "amanhã" : `em ${due}`}.`;

    try {
      await sendText(normalizePhone(bill.user.whatsappPhone), message);
      await prisma.bill.update({
        where: { id: bill.id },
        data: { remindedAt: now },
      });
      sent += 1;
    } catch (err) {
      console.error(`[reminders] falha ao avisar conta ${bill.id}:`, err);
    }
  }
  return sent;
}

billsRouter.post(
  "/run-reminders",
  asyncHandler(async (_req, res) => {
    const sent = await runBillReminders();
    res.json({ sent });
  }),
);
