import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { notFound } from "../../lib/errors.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { audit } from "../audit/audit.service.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";

export const usersRouter = Router();

usersRouter.use(requireAuth);

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
});

usersRouter.get(
  "/me",
  asyncHandler(async (req, res) => {
    const { sub } = (req as AuthedRequest).user!;
    const user = await prisma.user.findUnique({
      where: { id: sub },
      select: { id: true, name: true, email: true, role: true, createdAt: true, isActive: true },
    });
    if (!user) throw notFound("Usuário não encontrado");
    res.json({ user });
  }),
);

usersRouter.patch(
  "/me",
  asyncHandler(async (req, res) => {
    const { sub } = (req as AuthedRequest).user!;
    const data = updateSchema.parse(req.body);
    const user = await prisma.user.update({
      where: { id: sub },
      data,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    await audit({ userId: sub, action: "user.update", entityType: "user", entityId: user.id, req });
    res.json({ user });
  }),
);
