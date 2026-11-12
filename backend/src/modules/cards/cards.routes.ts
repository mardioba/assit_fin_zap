import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { conflict, notFound } from "../../lib/errors.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { paramId } from "../../lib/params.js";
import { invoicePeriod } from "../../lib/card-invoice.js";
import { audit } from "../audit/audit.service.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const cardsRouter = Router();
cardsRouter.use(requireAuth);

const daySchema = z.number().int().min(1).max(28);

const createSchema = z.object({
  name: z.string().min(1).max(60),
  brand: z.string().max(30).nullish(),
  limitCents: z.number().int().min(0).max(100_000_000_00),
  closingDay: daySchema,
  dueDay: daySchema,
});

const updateSchema = createSchema.partial();

function uid(req: Parameters<typeof requireAuth>[0]): string {
  return (req as AuthedRequest).user!.sub;
}

/** Fatura atual + compromissos futuros + limite disponível. */
async function cardStats(
  userId: string,
  card: { id: string; limitCents: number; closingDay: number; dueDay: number },
  ref = new Date(),
) {
  const { start, end, dueDate } = invoicePeriod(card.closingDay, card.dueDay, ref);

  const [invoiceSum, futureSum, count] = await Promise.all([
    prisma.transaction.aggregate({
      where: { userId, cardId: card.id, date: { gte: start, lt: end } },
      _sum: { amountCents: true },
      _count: true,
    }),
    prisma.transaction.aggregate({
      where: { userId, cardId: card.id, date: { gte: end } },
      _sum: { amountCents: true },
    }),
    prisma.transaction.count({ where: { userId, cardId: card.id } }),
  ]);

  const invoiceCents = invoiceSum._sum.amountCents ?? 0;
  const futureCents = futureSum._sum.amountCents ?? 0;
  return {
    invoiceCents,
    invoiceCount: invoiceSum._count,
    futureInstallmentsCents: futureCents,
    availableCents: card.limitCents - invoiceCents - futureCents,
    invoiceStart: start,
    invoiceEnd: end,
    invoiceDue: dueDate,
    transactionCount: count,
  };
}

cardsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const cards = await prisma.creditCard.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    const withStats = await Promise.all(
      cards.map(async (card) => ({ ...card, ...(await cardStats(userId, card)) })),
    );
    res.json({ cards: withStats });
  }),
);

cardsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = createSchema.parse(req.body);
    const card = await prisma.creditCard.create({ data: { ...data, userId } });
    const stats = await cardStats(userId, card);
    await audit({ userId, action: "card.create", entityType: "creditCard", entityId: card.id, metadata: { name: card.name }, req });
    res.status(201).json({ card: { ...card, ...stats } });
  }),
);

cardsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = updateSchema.parse(req.body);
    const existing = await prisma.creditCard.findFirst({
      where: { id: paramId(req, "Cartão"), userId },
    });
    if (!existing) throw notFound("Cartão não encontrado");
    const card = await prisma.creditCard.update({ where: { id: existing.id }, data });
    const stats = await cardStats(userId, card);
    await audit({ userId, action: "card.update", entityType: "creditCard", entityId: card.id, req });
    res.json({ card: { ...card, ...stats } });
  }),
);

cardsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const existing = await prisma.creditCard.findFirst({
      where: { id: paramId(req, "Cartão"), userId },
    });
    if (!existing) throw notFound("Cartão não encontrado");
    const txns = await prisma.transaction.count({ where: { cardId: existing.id } });
    if (txns > 0) {
      throw conflict("Cartão com compras não pode ser excluído. Desative-o.", "CARD_IN_USE");
    }
    await prisma.creditCard.delete({ where: { id: existing.id } });
    await audit({ userId, action: "card.delete", entityType: "creditCard", entityId: existing.id, req });
    res.json({ ok: true });
  }),
);

/** Fatura detalhada: ?ref=YYYY-MM-DD (padrão: hoje). */
cardsRouter.get(
  "/:id/invoice",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const card = await prisma.creditCard.findFirst({
      where: { id: paramId(req, "Cartão"), userId },
    });
    if (!card) throw notFound("Cartão não encontrado");

    const refQuery = z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .parse(req.query.ref);
    const ref = refQuery ? new Date(`${refQuery}T12:00:00`) : new Date();

    const stats = await cardStats(userId, card, ref);
    const items = await prisma.transaction.findMany({
      where: {
        userId,
        cardId: card.id,
        date: { gte: stats.invoiceStart, lt: stats.invoiceEnd },
      },
      orderBy: { date: "asc" },
      include: { category: true },
    });

    res.json({
      card: { id: card.id, name: card.name, limitCents: card.limitCents },
      period: {
        start: stats.invoiceStart.toISOString(),
        end: stats.invoiceEnd.toISOString(),
        due: stats.invoiceDue.toISOString(),
      },
      totalCents: stats.invoiceCents,
      availableCents: stats.availableCents,
      items,
    });
  }),
);
