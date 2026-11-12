import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { login, logout, refresh, register } from "./auth.service.js";
import { asyncHandler } from "../../lib/async-handler.js";

// Limite específico para rotas de autenticação (força-bruta).
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Muitas tentativas. Tente novamente em 15 minutos." },
});

export const authRouter = Router();

authRouter.post("/register", authLimiter, asyncHandler(register));
authRouter.post("/login", authLimiter, asyncHandler(login));
authRouter.post("/refresh", asyncHandler(refresh));
authRouter.post("/logout", asyncHandler(logout));
