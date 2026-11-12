import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const dashboardRouter = Router();

dashboardRouter.use(requireAuth);

/**
 * Fase 1 — estrutura do dashboard financeiro.
 * Os totais são calculados sobre dados REAIS do banco; até a Fase 2
 * (receitas/despesas) os valores virão zerados — nunca fictícios.
 * Endpoints de movimentação chegam na Fase 2 sem quebrar este contrato.
 */
dashboardRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const { sub } = (req as AuthedRequest).user!;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    // Fase 2 substituirá estas contagens por somas reais de
    // receitas/despesas (em centavos). Por ora, contamos registros
    // quando os módulos existirem; hoje respondemos com zeros reais.
    const [user, transactionsCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: sub },
        select: { name: true },
      }),
      // Tabela de movimentações existe a partir da Fase 2.
      countTransactions(monthStart, monthEnd),
    ]);

    res.json({
      user,
      period: { start: monthStart.toISOString(), end: monthEnd.toISOString() },
      totals: {
        balanceCents: 0,
        incomeMonthCents: 0,
        expenseMonthCents: 0,
        resultMonthCents: 0,
      },
      transactionsCount,
      pendingBillsPayable: 0,
      pendingBillsReceivable: 0,
      note: "Totais reais de receitas/despesas disponíveis a partir da Fase 2.",
    });
  }),
);

// Conta movimentações apenas se a tabela existir (evita erro antes da Fase 2).
async function countTransactions(_start: Date, _end: Date): Promise<number> {
  try {
    const result = await prisma.$queryRawUnsafe<{ c: number }[]>(
      "SELECT COUNT(*) as c FROM \"Transaction\"",
    );
    return Number(result[0]?.c ?? 0);
  } catch {
    return 0;
  }
}
