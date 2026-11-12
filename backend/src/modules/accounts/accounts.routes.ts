import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { isUniqueViolation } from "../../lib/prisma-errors.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { paramId } from "../../lib/params.js";
import { audit } from "../audit/audit.service.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const accountsRouter = Router();
accountsRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(["BANK", "CASH", "WALLET"]),
  initialBalanceCents: z.number().int().default(0),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  isActive: z.boolean().optional(),
});

const transferSchema = z.object({
  fromAccountId: z.string().min(1),
  toAccountId: z.string().min(1),
  amountCents: z.number().int().positive(),
  description: z.string().max(160).optional(),
  date: z.coerce.date().optional(),
});

function uid(req: Parameters<typeof requireAuth>[0]): string {
  return (req as AuthedRequest).user!.sub;
}

/**
 * Saldo real por conta:
 * saldo = saldo inicial + receitas - despesas da conta + transferências recebidas - enviadas.
 * Transferências NÃO contam como receita/despesa (regra do módulo).
 */
async function computeBalances(userId: string): Promise<Map<string, number>> {
  const [txns, sent, received] = await Promise.all([
    prisma.transaction.groupBy({
      by: ["accountId", "type"],
      where: { userId, accountId: { not: null } },
      _sum: { amountCents: true },
    }),
    prisma.transfer.groupBy({
      by: ["fromAccountId"],
      where: { userId },
      _sum: { amountCents: true },
    }),
    prisma.transfer.groupBy({
      by: ["toAccountId"],
      where: { userId },
      _sum: { amountCents: true },
    }),
  ]);

  const balances = new Map<string, number>();
  const add = (id: string | null, value: number) => {
    if (id) balances.set(id, (balances.get(id) ?? 0) + value);
  };

  for (const row of txns) {
    const sum = row._sum.amountCents ?? 0;
    add(row.accountId, row.type === "INCOME" ? sum : -sum);
  }
  for (const row of sent) add(row.fromAccountId, -(row._sum.amountCents ?? 0));
  for (const row of received) add(row.toAccountId, row._sum.amountCents ?? 0);

  return balances;
}

accountsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const [accounts, balances] = await Promise.all([
      prisma.account.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),
      computeBalances(userId),
    ]);
    res.json({
      accounts: accounts.map((a) => ({
        ...a,
        balanceCents: a.initialBalanceCents + (balances.get(a.id) ?? 0),
      })),
    });
  }),
);

accountsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = createSchema.parse(req.body);
    try {
      const account = await prisma.account.create({ data: { ...data, userId } });
      await audit({ userId, action: "account.create", entityType: "account", entityId: account.id, metadata: { name: account.name }, req });
      res.status(201).json({ account: { ...account, balanceCents: account.initialBalanceCents } });
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict("Conta já existe", "ACCOUNT_EXISTS");
      throw err;
    }
  }),
);

accountsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = updateSchema.parse(req.body);
    const existing = await prisma.account.findFirst({ where: { id: paramId(req), userId } });
    if (!existing) throw notFound("Conta não encontrada");
    const account = await prisma.account.update({ where: { id: existing.id }, data });
    await audit({ userId, action: "account.update", entityType: "account", entityId: account.id, req });
    res.json({ account });
  }),
);

accountsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const existing = await prisma.account.findFirst({ where: { id: paramId(req), userId } });
    if (!existing) throw notFound("Conta não encontrada");

    const [txnCount, transferCount] = await Promise.all([
      prisma.transaction.count({ where: { accountId: existing.id } }),
      prisma.transfer.count({
        where: { OR: [{ fromAccountId: existing.id }, { toAccountId: existing.id }] },
      }),
    ]);
    if (txnCount > 0 || transferCount > 0) {
      throw conflict(
        "Conta com movimentações não pode ser excluída. Desative-a em vez disso.",
        "ACCOUNT_IN_USE",
      );
    }
    await prisma.account.delete({ where: { id: existing.id } });
    await audit({ userId, action: "account.delete", entityType: "account", entityId: existing.id, req });
    res.json({ ok: true });
  }),
);

accountsRouter.post(
  "/transfer",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const data = transferSchema.parse(req.body);

    if (data.fromAccountId === data.toAccountId) {
      throw badRequest("Origem e destino devem ser contas diferentes", "SAME_ACCOUNT");
    }
    const [from, to] = await Promise.all([
      prisma.account.findFirst({ where: { id: data.fromAccountId, userId, isActive: true } }),
      prisma.account.findFirst({ where: { id: data.toAccountId, userId, isActive: true } }),
    ]);
    if (!from || !to) throw notFound("Conta não encontrada");

    const transfer = await prisma.transfer.create({
      data: {
        userId,
        fromAccountId: from.id,
        toAccountId: to.id,
        amountCents: data.amountCents,
        description: data.description,
        date: data.date ?? new Date(),
      },
    });
    await audit({ userId, action: "account.transfer", entityType: "transfer", entityId: transfer.id, metadata: { amountCents: data.amountCents }, req });
    res.status(201).json({ transfer });
  }),
);
