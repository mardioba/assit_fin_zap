import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { notFound } from "../../lib/errors.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { paramId } from "../../lib/params.js";
import { parseMonth } from "../../lib/finance.js";
import { audit } from "../audit/audit.service.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const transactionsRouter = Router();
transactionsRouter.use(requireAuth);

const listQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  type: z.enum(["INCOME", "EXPENSE"]).optional(),
  categoryId: z.string().optional(),
  accountId: z.string().optional(),
  search: z.string().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const createSchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  amountCents: z.number().int().positive().max(100_000_000_00),
  description: z.string().min(1).max(160),
  date: z.coerce.date(),
  categoryId: z.string().nullish(),
  accountId: z.string().nullish(),
  paymentMethod: z.enum(["PIX", "CASH", "CREDIT", "DEBIT", "TRANSFER", "OTHER"]).nullish(),
  establishment: z.string().max(120).nullish(),
});

const updateSchema = createSchema.partial();

function uid(req: Parameters<typeof requireAuth>[0]): string {
  return (req as AuthedRequest).user!.sub;
}

/** Garante que categoria/conta pertencem ao usuário (isolamento — item 8). */
async function assertOwnership(
  userId: string,
  ids: { categoryId?: string | null; accountId?: string | null },
): Promise<void> {
  if (ids.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: ids.categoryId, userId },
    });
    if (!category) throw notFound("Categoria não encontrada");
  }
  if (ids.accountId) {
    const account = await prisma.account.findFirst({
      where: { id: ids.accountId, userId },
    });
    if (!account) throw notFound("Conta não encontrada");
  }
}

transactionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const q = listQuerySchema.parse(req.query);

    const where = {
      userId,
      ...(q.month
        ? { date: { gte: parseMonth(q.month).start, lt: parseMonth(q.month).end } }
        : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.accountId ? { accountId: q.accountId } : {}),
      ...(q.search
        ? { description: { contains: q.search } }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        orderBy: { date: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { category: true, account: true },
      }),
      prisma.transaction.count({ where }),
    ]);

    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  }),
);

transactionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = createSchema.parse(req.body);
    await assertOwnership(userId, data);

    const transaction = await prisma.transaction.create({
      data: { ...data, userId },
      include: { category: true, account: true },
    });
    await audit({
      userId,
      action: "transaction.create",
      entityType: "transaction",
      entityId: transaction.id,
      metadata: { type: data.type, amountCents: data.amountCents },
      req,
    });
    res.status(201).json({ transaction });
  }),
);

transactionsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = updateSchema.parse(req.body);
    const existing = await prisma.transaction.findFirst({
      where: { id: paramId(req), userId },
    });
    if (!existing) throw notFound("Movimentação não encontrada");

    await assertOwnership(userId, {
      categoryId: data.categoryId === undefined ? existing.categoryId : data.categoryId,
      accountId: data.accountId === undefined ? existing.accountId : data.accountId,
    });

    const transaction = await prisma.transaction.update({
      where: { id: existing.id },
      data,
      include: { category: true, account: true },
    });
    await audit({ userId, action: "transaction.update", entityType: "transaction", entityId: transaction.id, req });
    res.json({ transaction });
  }),
);

transactionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const existing = await prisma.transaction.findFirst({
      where: { id: paramId(req), userId },
    });
    if (!existing) throw notFound("Movimentação não encontrada");
    await prisma.transaction.delete({ where: { id: existing.id } });
    await audit({
      userId,
      action: "transaction.delete",
      entityType: "transaction",
      entityId: existing.id,
      metadata: { amountCents: existing.amountCents },
      req,
    });
    res.json({ ok: true });
  }),
);
