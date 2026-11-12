import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { notFound } from "../../lib/errors.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { paramId } from "../../lib/params.js";
import { audit } from "../audit/audit.service.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const recurringRouter = Router();
recurringRouter.use(requireAuth);

const daySchema = z.number().int().min(1).max(28);

const createSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amountCents: z.number().int().positive().max(100_000_000_00),
  description: z.string().min(1).max(160),
  dayOfMonth: daySchema,
  categoryId: z.string().nullish(),
  accountId: z.string().nullish(),
  cardId: z.string().nullish(),
  paymentMethod: z
    .enum(["PIX", "CASH", "CREDIT", "DEBIT", "TRANSFER", "OTHER"])
    .nullish(),
  establishment: z.string().max(120).nullish(),
  active: z.boolean().optional(),
});

const updateSchema = createSchema.partial().extend({ active: z.boolean().optional() });

function uid(req: Parameters<typeof requireAuth>[0]): string {
  return (req as AuthedRequest).user!.sub;
}

async function assertOwnership(
  userId: string,
  ids: { categoryId?: string | null; accountId?: string | null; cardId?: string | null },
): Promise<void> {
  if (ids.categoryId) {
    const c = await prisma.category.findFirst({ where: { id: ids.categoryId, userId } });
    if (!c) throw notFound("Categoria não encontrada");
  }
  if (ids.accountId) {
    const a = await prisma.account.findFirst({ where: { id: ids.accountId, userId } });
    if (!a) throw notFound("Conta não encontrada");
  }
  if (ids.cardId) {
    const c = await prisma.creditCard.findFirst({ where: { id: ids.cardId, userId } });
    if (!c) throw notFound("Cartão não encontrado");
  }
}

recurringRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const rules = await prisma.recurringRule.findMany({
      where: { userId: uid(req) },
      orderBy: { createdAt: "asc" },
    });
    res.json({ rules });
  }),
);

recurringRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = createSchema.parse(req.body);
    await assertOwnership(userId, data);
    const rule = await prisma.recurringRule.create({
      data: { ...data, userId, paymentMethod: data.paymentMethod ?? null },
    });
    await audit({ userId, action: "recurring.create", entityType: "recurringRule", entityId: rule.id, metadata: { description: rule.description }, req });
    res.status(201).json({ rule });
  }),
);

recurringRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = updateSchema.parse(req.body);
    const existing = await prisma.recurringRule.findFirst({
      where: { id: paramId(req, "Regra"), userId },
    });
    if (!existing) throw notFound("Regra não encontrada");
    await assertOwnership(userId, data);
    const rule = await prisma.recurringRule.update({
      where: { id: existing.id },
      data,
    });
    await audit({ userId, action: "recurring.update", entityType: "recurringRule", entityId: rule.id, req });
    res.json({ rule });
  }),
);

recurringRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const existing = await prisma.recurringRule.findFirst({
      where: { id: paramId(req, "Regra"), userId },
    });
    if (!existing) throw notFound("Regra não encontrada");
    await prisma.recurringRule.delete({ where: { id: existing.id } });
    await audit({ userId, action: "recurring.delete", entityType: "recurringRule", entityId: existing.id, req });
    res.json({ ok: true });
  }),
);

/**
 * Materializa as recorrências do mês atual (idempotente — dedupe por
 * recurrenceKey "ruleId:YYYY-MM"). Chamado na API para o usuário atual e,
 * em produção, por um agendador horário (server.ts).
 */
export async function materializeRecurring(
  userId?: string,
  now: Date = new Date(),
): Promise<number> {
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rules = await prisma.recurringRule.findMany({
    where: { active: true, ...(userId ? { userId } : {}) },
  });

  let created = 0;
  for (const rule of rules) {
    const recurrenceKey = `${rule.id}:${monthKey}`;
    const exists = await prisma.transaction.findUnique({
      where: { recurrenceKey },
      select: { id: true },
    });
    if (exists) continue;

    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const day = Math.min(rule.dayOfMonth, lastDay);
    const date = new Date(now.getFullYear(), now.getMonth(), day, 12);

    try {
      await prisma.transaction.create({
        data: {
          userId: rule.userId,
          type: rule.type,
          amountCents: rule.amountCents,
          description: rule.description,
          date,
          categoryId: rule.categoryId,
          accountId: rule.accountId,
          cardId: rule.cardId,
          paymentMethod: rule.paymentMethod,
          establishment: rule.establishment,
          recurrenceKey,
        },
      });
      created += 1;
    } catch (err) {
      // Corrida com o agendador: ignora duplicidade.
      const code = (err as { code?: string }).code;
      if (code !== "P2002") throw err;
    }
  }
  return created;
}

recurringRouter.post(
  "/run",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const created = await materializeRecurring(userId);
    res.json({ created });
  }),
);
