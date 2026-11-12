import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { parseMonth } from "../../lib/finance.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

/**
 * Resumo do dashboard — FASE 2.
 * Todos os valores são somas REAIS do banco de dados do usuário autenticado.
 * A IA (Fase 3) e o frontend consomem exatamente este contrato.
 */
dashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const userId = (req as AuthedRequest).user!.sub;
    const { start, end, key } = parseMonth(
      typeof req.query.month === "string" ? req.query.month : undefined,
    );

    const [user, accounts, monthGrouped, allTimeGrouped, transactionsCount, billsGrouped] =
      await Promise.all([
        prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
        prisma.account.findMany({ where: { userId }, select: { initialBalanceCents: true } }),
        prisma.transaction.groupBy({
          by: ["type"],
          where: { userId, date: { gte: start, lt: end } },
          _sum: { amountCents: true },
        }),
        prisma.transaction.groupBy({
          by: ["type"],
          where: { userId },
          _sum: { amountCents: true },
        }),
        prisma.transaction.count({ where: { userId, date: { gte: start, lt: end } } }),
        prisma.bill.groupBy({
          by: ["type"],
          where: { userId, paidAt: null },
          _count: true,
        }),
      ]);

    const sumOf = (rows: typeof monthGrouped, type: string) =>
      rows.find((r) => r.type === type)?._sum.amountCents ?? 0;

    const incomeMonthCents = sumOf(monthGrouped, "INCOME");
    const expenseMonthCents = sumOf(monthGrouped, "EXPENSE");

    // Saldo total = somatório dos saldos iniciais + receitas - despesas (histórico).
    // Transferências entre contas se anulam no total (só movem saldo entre contas).
    const initialBalanceCents = accounts.reduce((s, a) => s + a.initialBalanceCents, 0);
    const balanceCents =
      initialBalanceCents + sumOf(allTimeGrouped, "INCOME") - sumOf(allTimeGrouped, "EXPENSE");

    res.json({
      user,
      period: { start: start.toISOString(), end: end.toISOString(), month: key },
      totals: {
        balanceCents,
        incomeMonthCents,
        expenseMonthCents,
        resultMonthCents: incomeMonthCents - expenseMonthCents,
      },
      transactionsCount,
      // Contas a pagar/receiber em aberto (inclui atrasadas) — Fase 4.
      pendingBillsPayable:
        billsGrouped.find((g) => g.type === "PAYABLE")?._count ?? 0,
      pendingBillsReceivable:
        billsGrouped.find((g) => g.type === "RECEIVABLE")?._count ?? 0,
    });
  }),
);
