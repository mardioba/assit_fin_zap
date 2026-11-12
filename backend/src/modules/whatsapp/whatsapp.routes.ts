import { Router } from "express";
import { z } from "zod";
import { env } from "../../config/env.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { badRequest } from "../../lib/errors.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { resolveProvider } from "../ai/ai.js";
import { isWhatsAppConfigured, normalizePhone, outbox, sendText } from "./whatsapp.client.js";
import { resolveMediaProvider } from "../ai/media.js";
import {
  handleWebhookPayload,
  verifySignature,
  verifyWebhook,
} from "./whatsapp.service.js";

export const whatsappRouter = Router();

/**
 * GET /api/whatsapp/webhook — verificação do webhook pela Meta
 * (hub.mode=subscribe, hub.verify_token, hub.challenge).
 */
whatsappRouter.get("/webhook", (req, res) => {
  const challenge = verifyWebhook(req.query as Record<string, unknown>);
  if (!challenge) {
    res.status(403).json({ message: "Token de verificação inválido", code: "VERIFY_FAILED" });
    return;
  }
  res.status(200).send(challenge);
});

/**
 * POST /api/whatsapp/webhook — recepção de mensagens.
 * Valida a assinatura HMAC (X-Hub-Signature-256) quando o app secret está
 * configurado e responde 200 imediatamente (regra da Meta).
 */
whatsappRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    const signature = req.get("x-hub-signature-256");

    if (rawBody && !verifySignature(rawBody, signature)) {
      res.status(403).json({ message: "Assinatura inválida", code: "BAD_SIGNATURE" });
      return;
    }

    const result = await handleWebhookPayload(req.body);
    res.status(200).json({ ok: true, ...result });
  }),
);

const sendSchema = z.object({
  phone: z.string().min(8).max(20),
  message: z.string().min(1).max(4096),
});

/** POST /api/whatsapp/send — envia mensagem (painel autenticado / testes). */
whatsappRouter.post(
  "/send",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = sendSchema.parse(req.body);
    const result = await sendText(normalizePhone(data.phone), data.message);
    res.status(201).json({ ok: true, ...result });
  }),
);

/** GET /api/whatsapp/status — configuração atual (sem expor segredos). */
whatsappRouter.get("/status", requireAuth, (_req, res) => {
  res.json({
    whatsappConfigured: isWhatsAppConfigured(),
    verifyTokenSet: Boolean(env.whatsapp.verifyToken),
    appSecretSet: Boolean(env.whatsapp.appSecret),
    aiProvider: resolveProvider(),
    mediaProvider: resolveMediaProvider(),
    queuedOutbox: outbox.length,
  });
});

/** POST /api/whatsapp/test-interpret — debug: mostra como a IA interpreta. */
whatsappRouter.post(
  "/test-interpret",
  requireAuth,
  asyncHandler(async (req, res) => {
    const data = z.object({ text: z.string().min(1).max(2000) }).parse(req.body);
    if (!data.text.trim()) throw badRequest("Texto vazio");
    const { interpretMessage } = await import("../ai/ai.js");
    const interpretation = await interpretMessage(data.text);
    res.json({ interpretation });
  }),
);
