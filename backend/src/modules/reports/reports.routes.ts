import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { lastMonths, parseMonth } from "../../lib/finance.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const monthQuery = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

function uid(req: Parameters<typeof requireAuth>[0]): string {
  return (req as AuthedRequest).user!.sub;
}

/** Resumo do mês: receitas, despesas e resultado — sempre de dados reais. */
reportsRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const { start, end, key } = parseMonth(monthQuery.parse(req.query).month);

    const grouped = await prisma.transaction.groupBy({
      by: ["type"],
      where: { userId, date: { gte: start, lt: end } },
      _sum: { amountCents: true },
      _count: true,
    });

    const income = grouped.find((g) => g.type === "INCOME");
    const expense = grouped.find((g) => g.type === "EXPENSE");
    const incomeCents = income?._sum.amountCents ?? 0;
    const expenseCents = expense?._sum.amountCents ?? 0;

    res.json({
      month: key,
      incomeCents,
      expenseCents,
      resultCents: incomeCents - expenseCents,
      incomeCount: income?._count ?? 0,
      expenseCount: expense?._count ?? 0,
    });
  }),
);

/** Despesas/receitas agrupadas por categoria no mês (gráficos e consultas). */
reportsRouter.get(
  "/by-category",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const query = monthQuery
      .extend({ type: z.enum(["INCOME", "EXPENSE"]).default("EXPENSE") })
      .parse(req.query);
    const { start, end, key } = parseMonth(query.month);

    const grouped = await prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { userId, type: query.type, date: { gte: start, lt: end } },
      _sum: { amountCents: true },
      _count: true,
    });

    const categoryIds = grouped.map((g) => g.categoryId).filter((id): id is string => !!id);
    const categories = await prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, color: true },
    });
    const categoryMap = new Map(categories.map((c) => [c.id, c]));

    const totalCents = grouped.reduce((sum, g) => sum + (g._sum.amountCents ?? 0), 0);

    const byCategory = grouped
      .map((g) => {
        const category = g.categoryId ? categoryMap.get(g.categoryId) : null;
        const total = g._sum.amountCents ?? 0;
        return {
          categoryId: g.categoryId,
          categoryName: category?.name ?? "Sem categoria",
          color: category?.color ?? null,
          totalCents: total,
          count: g._count,
          percent: totalCents > 0 ? Math.round((total / totalCents) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => b.totalCents - a.totalCents);

    res.json({ month: key, type: query.type, totalCents, byCategory });
  }),
);

/** Série mensal (receitas x despesas) para gráficos — padrão: 6 meses. */
reportsRouter.get(
  "/monthly",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const { months } = z
      .object({ months: z.coerce.number().int().min(1).max(24).default(6) })
      .parse(req.query);

    const keys = lastMonths(months);

    // Agrega por mês via queries individuais (simplicidade e portabilidade).
    const series = await Promise.all(
      keys.map(async (key) => {
        const { start, end } = parseMonth(key);
        const grouped = await prisma.transaction.groupBy({
          by: ["type"],
          where: { userId, date: { gte: start, lt: end } },
          _sum: { amountCents: true },
        });
        const incomeCents = grouped.find((g) => g.type === "INCOME")?._sum.amountCents ?? 0;
        const expenseCents = grouped.find((g) => g.type === "EXPENSE")?._sum.amountCents ?? 0;
        return { month: key, incomeCents, expenseCents, resultCents: incomeCents - expenseCents };
      }),
    );

    res.json({ series });
  }),
);
