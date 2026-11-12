import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { conflict, notFound } from "../../lib/errors.js";
import { isUniqueViolation } from "../../lib/prisma-errors.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { paramId } from "../../lib/params.js";
import { audit } from "../audit/audit.service.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(60),
  type: z.enum(["INCOME", "EXPENSE"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});

function userId(req: Parameters<typeof requireAuth>[0]): string {
  return (req as AuthedRequest).user!.sub;
}

categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const type = z.enum(["INCOME", "EXPENSE"]).optional().parse(req.query.type);
    const categories = await prisma.category.findMany({
      where: { userId: userId(req), ...(type ? { type } : {}) },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    res.json({ categories });
  }),
);

categoriesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const uid = userId(req);
    const data = createSchema.parse(req.body);
    try {
      const category = await prisma.category.create({
        data: { ...data, userId: uid },
      });
      await audit({ userId: uid, action: "category.create", entityType: "category", entityId: category.id, req });
      res.status(201).json({ category });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict("Você já tem uma categoria com esse nome e tipo", "CATEGORY_EXISTS");
      }
      throw err;
    }
  }),
);

categoriesRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const uid = userId(req);
    const data = updateSchema.parse(req.body);
    const existing = await prisma.category.findFirst({
      where: { id: paramId(req), userId: uid },
    });
    if (!existing) throw notFound("Categoria não encontrada");
    try {
      const category = await prisma.category.update({
        where: { id: existing.id },
        data,
      });
      await audit({ userId: uid, action: "category.update", entityType: "category", entityId: category.id, req });
      res.json({ category });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw conflict("Você já tem uma categoria com esse nome e tipo", "CATEGORY_EXISTS");
      }
      throw err;
    }
  }),
);

categoriesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const uid = userId(req);
    const existing = await prisma.category.findFirst({
      where: { id: paramId(req), userId: uid },
    });
    if (!existing) throw notFound("Categoria não encontrada");
    // Movimentações vinculadas ficam sem categoria (onDelete: SetNull).
    await prisma.category.delete({ where: { id: existing.id } });
    await audit({ userId: uid, action: "category.delete", entityType: "category", entityId: existing.id, req });
    res.json({ ok: true });
  }),
);
