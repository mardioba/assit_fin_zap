import { Router } from "express";
import PDFDocument from "pdfkit";
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

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return `${date.toLocaleDateString("pt-BR", { month: "long" })} de ${y}`;
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

/** Relatório anual: 12 meses + totais do ano. */
reportsRouter.get(
  "/annual",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const { year } = z
      .object({ year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear()) })
      .parse(req.query);

    const series: Array<{
      month: string;
      incomeCents: number;
      expenseCents: number;
      resultCents: number;
    }> = [];
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${String(m).padStart(2, "0")}`;
      const { start, end } = parseMonth(key);
      const grouped = await prisma.transaction.groupBy({
        by: ["type"],
        where: { userId, date: { gte: start, lt: end } },
        _sum: { amountCents: true },
      });
      const incomeCents = grouped.find((g) => g.type === "INCOME")?._sum.amountCents ?? 0;
      const expenseCents = grouped.find((g) => g.type === "EXPENSE")?._sum.amountCents ?? 0;
      series.push({ month: key, incomeCents, expenseCents, resultCents: incomeCents - expenseCents });
    }

    const incomeYearCents = series.reduce((s, p) => s + p.incomeCents, 0);
    const expenseYearCents = series.reduce((s, p) => s + p.expenseCents, 0);
    res.json({
      year,
      series,
      totals: {
        incomeCents: incomeYearCents,
        expenseCents: expenseYearCents,
        resultCents: incomeYearCents - expenseYearCents,
      },
    });
  }),
);

// ---------- Exportação (Fase 4/7) ----------

type ExportRow = {
  date: Date;
  type: string;
  description: string;
  categoryName: string | null;
  accountName: string | null;
  cardName: string | null;
  establishment: string | null;
  paymentMethod: string | null;
  amountCents: number;
};

async function loadRows(userId: string, monthKey: string): Promise<ExportRow[]> {
  const { start, end } = parseMonth(monthKey);
  const items = await prisma.transaction.findMany({
    where: { userId, date: { gte: start, lt: end } },
    orderBy: { date: "asc" },
    include: { category: true, account: true, card: true },
  });
  return items.map((t) => ({
    date: t.date,
    type: t.type,
    description: t.description,
    categoryName: t.category?.name ?? null,
    accountName: t.account?.name ?? null,
    cardName: t.card?.name ?? null,
    establishment: t.establishment,
    paymentMethod: t.paymentMethod,
    amountCents: t.amountCents,
  }));
}

function csvEscape(value: string): string {
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Exporta o mês em CSV com BOM — abre direto no Excel (pt-BR). */
reportsRouter.get(
  "/export",
  asyncHandler(async (req, res) => {
    const userId = uid(req);
    const query = monthQuery
      .extend({ format: z.enum(["csv", "pdf"]).default("csv") })
      .parse(req.query);
    const { key } = parseMonth(query.month);
    const rows = await loadRows(userId, key);

    const summary = await prisma.transaction.groupBy({
      by: ["type"],
      where: {
        userId,
        ...(() => {
          const { start, end } = parseMonth(key);
          return { date: { gte: start, lt: end } };
        })(),
      },
      _sum: { amountCents: true },
    });
    const incomeCents = summary.find((g) => g.type === "INCOME")?._sum.amountCents ?? 0;
    const expenseCents = summary.find((g) => g.type === "EXPENSE")?._sum.amountCents ?? 0;

    if (query.format === "csv") {
      const header = [
        "Data", "Tipo", "Descrição", "Categoria", "Conta", "Cartão",
        "Estabelecimento", "Pagamento", "Valor (R$)",
      ].join(";");
      const lines = rows.map((r) =>
        [
          r.date.toLocaleDateString("pt-BR"),
          r.type === "INCOME" ? "Receita" : "Despesa",
          r.description,
          r.categoryName ?? "",
          r.accountName ?? "",
          r.cardName ?? "",
          r.establishment ?? "",
          r.paymentMethod ?? "",
          (r.amountCents / 100).toFixed(2).replace(".", ","),
        ]
          .map(csvEscape)
          .join(";"),
      );
      const csv = [header, ...lines].join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="movimentacoes-${key}.csv"`,
      );
      // BOM para o Excel reconhecer UTF-8.
      res.send(`\uFEFF${csv}`);
      return;
    }

    // PDF via pdfkit.
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="movimentacoes-${key}.pdf"`,
    );
    doc.pipe(res);

    doc.fontSize(18).text("Relatório financeiro", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(12).fillColor("#444444").text(monthLabel(key), { align: "center" });
    doc.moveDown(1.5);

    doc.fillColor("#000000").fontSize(12).text("Resumo");
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor("#333333");
    doc.text(`Receitas: ${brl(incomeCents)}`);
    doc.text(`Despesas: ${brl(expenseCents)}`);
    doc.text(`Resultado: ${brl(incomeCents - expenseCents)}`);
    doc.text(`Movimentações: ${rows.length}`);
    doc.moveDown(1.5);

    doc.fillColor("#000000").fontSize(12).text("Movimentações");
    doc.moveDown(0.5);

    doc.fontSize(9).fillColor("#666666");
    doc.text("Data      Descrição                          Valor", {
      underline: false,
    });
    doc.moveDown(0.2);

    for (const row of rows) {
      const date = row.date.toLocaleDateString("pt-BR");
      const desc = `${row.description}${row.categoryName ? ` (${row.categoryName})` : ""}`.slice(0, 40);
      const value = `${row.type === "INCOME" ? "+" : "-"} ${brl(row.amountCents)}`.padStart(14);
      doc.fillColor(row.type === "INCOME" ? "#059669" : "#dc2626").text(
        `${date}  ${desc.padEnd(42)} ${value}`,
      );
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#999999").text(
      `Gerado em ${new Date().toLocaleString("pt-BR")} — Assistente Financeiro`,
      { align: "center" },
    );
    doc.end();
  }),
);
