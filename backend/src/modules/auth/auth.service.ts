import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { conflict, unauthorized } from "../../lib/errors.js";
import { DEFAULT_CATEGORIES } from "../../lib/finance.js";
import type { AuthedRequest } from "../../middlewares/error.middleware.js";
import { prisma } from "../../lib/prisma.js";
import { audit } from "../audit/audit.service.js";
import {
  generateRefreshToken,
  hashToken,
  refreshExpiryDate,
  signAccessToken,
} from "./auth.tokens.js";

const COOKIE = {
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: "lax" as const,
  path: "/",
};

export const registerSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email().toLowerCase(),
  password: z.string().min(8).max(72),
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1).max(72),
});

const PUBLIC_USER = { id: true, name: true, email: true, role: true, createdAt: true } as const;

async function issueSession(res: Response, user: {
  id: string; email: string; role: string; name: string;
}): Promise<void> {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, tokenHash } = generateRefreshToken();

  await prisma.refreshToken.create({
    data: { tokenHash, userId: user.id, expiresAt: refreshExpiryDate() },
  });

  res.cookie("accessToken", accessToken, { ...COOKIE, maxAge: 15 * 60 * 1000 });
  res.cookie("refreshToken", refreshToken, {
    ...COOKIE,
    maxAge: env.jwt.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
}

export async function register(req: Request, res: Response): Promise<void> {
  const data = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) throw conflict("E-mail já cadastrado", "EMAIL_IN_USE");

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      passwordHash,
      // Categorias padrão = configuração de uso (não são dados fictícios).
      categories: {
        create: DEFAULT_CATEGORIES.map((c) => ({ ...c, isDefault: true })),
      },
    },
    select: PUBLIC_USER,
  });

  await issueSession(res, user);
  await audit({ userId: user.id, action: "auth.register", req });
  res.status(201).json({ user });
}

export async function login(req: Request, res: Response): Promise<void> {
  const data = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email: data.email },
    select: { ...PUBLIC_USER, passwordHash: true, isActive: true },
  });
  // Mensagem genérica para não revelar se o e-mail existe (enumeration).
  if (!user || !user.isActive) throw unauthorized("Credenciais inválidas", "INVALID_CREDENTIALS");

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) throw unauthorized("Credenciais inválidas", "INVALID_CREDENTIALS");

  const { passwordHash: _ph, isActive: _ia, ...safeUser } = user;
  await issueSession(res, safeUser);
  await audit({ userId: user.id, action: "auth.login", req });
  res.json({ user: safeUser });
}

/** Rotação de refresh token: um token é válido uma única vez. */
export async function refresh(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.refreshToken as string | undefined;
  if (!token) throw unauthorized("Sessão expirada", "NO_REFRESH_TOKEN");

  const stored = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (
    !stored ||
    stored.revokedAt ||
    stored.expiresAt < new Date() ||
    !stored.user.isActive
  ) {
    throw unauthorized("Sessão inválida", "INVALID_REFRESH_TOKEN");
  }

  // Revoga o token atual e emite novos (rotação).
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  await issueSession(res, stored.user);
  res.json({ ok: true });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.refreshToken as string | undefined;
  if (token) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  if ((req as AuthedRequest).user) {
    await audit({ userId: (req as AuthedRequest).user!.sub, action: "auth.logout", req });
  }
  res.clearCookie("accessToken", { path: "/" });
  res.clearCookie("refreshToken", { path: "/" });
  res.json({ ok: true });
}
